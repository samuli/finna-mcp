import argparse
import asyncio
import io
import json
import os
import sys
import atexit
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


async def run_cli(question: str, mcp_url: str, model: str) -> None:
    instructions = (
        """You are a data assistant for Finna via MCP.
        Use the available MCP tools to search records and fetch metadata.
        Prefer returning records with actionable resources (images, attachments, online URLs).
        When filters are needed, use the structured filter helper.
        Do not ask the user for more information unless absolutely required."""
    )

    color_reset = "\033[0m"
    color_call = "\033[36m"
    color_response = "\033[33m"
    color_answer = "\033[32m"

    call_counter = {"count": 0}

    async def process_tool_call(ctx, call_tool, name, tool_args):
        call_counter["count"] += 1
        call_id = call_counter["count"]
        print(f"\n{color_call}MCP CALL #{call_id}:{color_reset}", flush=True)
        print(
            json.dumps({"name": name, "arguments": tool_args}, indent=2, ensure_ascii=True),
            flush=True,
        )
        try:
            result = await call_tool(name, tool_args, None)
        except Exception as exc:  # pragma: no cover - diagnostic path
            print(f"{color_response}MCP ERROR #{call_id}:{color_reset}", flush=True)
            print(str(exc), flush=True)
            raise
        print(f"{color_response}MCP RESPONSE #{call_id}:{color_reset}", flush=True)
        print(json.dumps(result, indent=2, ensure_ascii=True, default=str), flush=True)
        return result

    server = MCPServerStreamableHTTP(mcp_url, process_tool_call=process_tool_call)
    async with server:
        agent = Agent(model, toolsets=[server], instructions=instructions)

        history: list[object] = []

        async def run_with_history(user_input: str) -> None:
            nonlocal history
            try:
                result = await agent.run(user_input, message_history=history)
            except Exception as exc:  # pragma: no cover - CLI error path
                print(f"\nERROR: {exc}")
                return

            if hasattr(result, "all_messages"):
                history = list(result.all_messages())

            print(f"\n{color_answer}LLM RESPONSE:{color_reset}")
            print(result.output if hasattr(result, "output") else result)

        if question:
            await run_with_history(question)

        while True:
            user_input = input("\nAsk a question (/clear to reset, /exit to quit): ").strip()
            if not user_input:
                continue
            if user_input.lower() == "/exit":
                break
            if user_input.lower() == "/clear":
                history = []
                print("History cleared.")
                continue
            await run_with_history(user_input)


def main() -> None:
    parser = argparse.ArgumentParser(description="PydanticAI MCP CLI")
    parser.add_argument("question", nargs="*", help="Question to ask the model")
    args = parser.parse_args()

    _configure_stdio()
    _configure_history()

    question = " ".join(args.question).strip()

    mcp_url = os.environ.get("MCP_URL", "http://localhost:8787/mcp")
    model_id = os.environ.get("MODEL_ID", "openai:gpt-4o-mini")
    model = os.environ.get("MODEL", model_id)

    asyncio.run(run_cli(question, mcp_url, model))


if __name__ == "__main__":
    main()
