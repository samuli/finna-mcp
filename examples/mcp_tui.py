import argparse
import asyncio
import atexit
import curses
import io
import json
import os
import sys
import textwrap
import readline

from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStreamableHTTP


def _configure_stdio() -> None:
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        return
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def _configure_history() -> None:
    history_path = os.environ.get("FINNA_MCP_HISTORY", "~/.finna_mcp_history")
    history_file = os.path.expanduser(history_path)
    try:
        readline.read_history_file(history_file)
    except FileNotFoundError:
        pass
    except Exception:
        return

    def save_history() -> None:
        try:
            readline.write_history_file(history_file)
        except Exception:
            pass

    atexit.register(save_history)


def _wrap_lines(lines, width):
    wrapped = []
    for line in lines:
        wrapped.extend(textwrap.wrap(line, width=width) or [""])
    return wrapped


def _draw_panel(win, title, lines, height, width):
    win.erase()
    win.box()
    title = f" {title} "
    try:
        win.addstr(0, max(1, (width - len(title)) // 2), title)
    except curses.error:
        pass
    body_height = height - 2
    visible = lines[-body_height:]
    for idx, line in enumerate(visible):
        if idx >= body_height:
            break
        try:
            win.addstr(1 + idx, 1, line[: width - 2])
        except curses.error:
            pass
    win.noutrefresh()


def run_tui(question: str, mcp_url: str, model: str) -> None:
    instructions = (
        """You are a data assistant for Finna via MCP.
        Use the available MCP tools to search records and fetch metadata.
        Prefer returning records with actionable resources (images, attachments, online URLs).
        When filters are needed, use the structured filter helper.
        Do not ask the user for more information unless absolutely required."""
    )

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    history: list[object] = []
    conversation: list[str] = []
    mcp_calls: list[str] = []
    mcp_responses: list[str] = []

    async def process_tool_call(ctx, call_tool, name, tool_args):
        mcp_calls.append(json.dumps({"name": name, "arguments": tool_args}, ensure_ascii=True))
        try:
            result = await call_tool(name, tool_args, None)
        except Exception as exc:
            mcp_responses.append(str(exc))
            raise
        mcp_responses.append(json.dumps(result, ensure_ascii=True, default=str))
        return result

    server = MCPServerStreamableHTTP(mcp_url, process_tool_call=process_tool_call)
    loop.run_until_complete(server.__aenter__())
    agent = Agent(model, toolsets=[server], instructions=instructions)

    def render(stdscr):
        stdscr.clear()
        height, width = stdscr.getmaxyx()
        input_height = 3
        panel_height = max(6, (height - input_height) // 3)
        conv_height = panel_height
        calls_height = panel_height
        resp_height = height - input_height - conv_height - calls_height
        if resp_height < 6:
            resp_height = 6
            conv_height = max(6, (height - input_height - resp_height) // 2)
            calls_height = height - input_height - resp_height - conv_height

        conv_win = stdscr.derwin(conv_height, width, 0, 0)
        calls_win = stdscr.derwin(calls_height, width, conv_height, 0)
        resp_win = stdscr.derwin(resp_height, width, conv_height + calls_height, 0)
        input_win = stdscr.derwin(input_height, width, height - input_height, 0)

        conv_lines = _wrap_lines(conversation, width - 2)
        call_lines = _wrap_lines(mcp_calls, width - 2)
        resp_lines = _wrap_lines(mcp_responses, width - 2)

        _draw_panel(conv_win, "Conversation", conv_lines, conv_height, width)
        _draw_panel(calls_win, "MCP Calls", call_lines, calls_height, width)
        _draw_panel(resp_win, "MCP Responses", resp_lines, resp_height, width)

        input_win.erase()
        input_win.box()
        input_win.addstr(0, 2, " Input ")
        input_win.addstr(1, 1, "> ")
        input_win.noutrefresh()
        curses.doupdate()

    def prompt_input(stdscr) -> str:
        input_win = stdscr.derwin(3, stdscr.getmaxyx()[1], stdscr.getmaxyx()[0] - 3, 0)
        input_win.erase()
        input_win.box()
        input_win.addstr(0, 2, " Input ")
        input_win.addstr(1, 1, "> ")
        input_win.refresh()
        curses.echo()
        try:
            value = input_win.getstr(1, 3).decode("utf-8")
        except Exception:
            value = ""
        curses.noecho()
        return value.strip()

    def run_with_history(user_input: str) -> None:
        nonlocal history
        conversation.append(f"User: {user_input}")
        try:
            result = loop.run_until_complete(agent.run(user_input, message_history=history))
        except Exception as exc:
            conversation.append(f"Assistant: ERROR: {exc}")
            return
        if hasattr(result, "all_messages"):
            history = list(result.all_messages())
        output = result.output if hasattr(result, "output") else str(result)
        conversation.append(f"Assistant: {output}")

    def tui_main(stdscr):
        curses.curs_set(1)
        stdscr.nodelay(False)
        if question:
            run_with_history(question)
        while True:
            render(stdscr)
            user_input = prompt_input(stdscr)
            if not user_input:
                continue
            if user_input.lower() == "/exit":
                break
            if user_input.lower() == "/clear":
                conversation.clear()
                mcp_calls.clear()
                mcp_responses.clear()
                history.clear()
                continue
            run_with_history(user_input)

    try:
        curses.wrapper(tui_main)
    finally:
        loop.run_until_complete(server.__aexit__(None, None, None))
        loop.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="PydanticAI MCP TUI")
    parser.add_argument("question", nargs="*", help="Question to ask the model")
    args = parser.parse_args()

    _configure_stdio()
    _configure_history()

    question = " ".join(args.question).strip()

    mcp_url = os.environ.get("MCP_URL", "http://localhost:8787/mcp")
    model_id = os.environ.get("MODEL_ID", "openai:gpt-4o-mini")
    model = os.environ.get("MODEL", model_id)

    run_tui(question, mcp_url, model)


if __name__ == "__main__":
    main()
