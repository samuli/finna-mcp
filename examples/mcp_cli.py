import argparse
import asyncio
import io
import json
import os
import sys
import atexit
import readline
import urllib.request
import time

from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStreamableHTTP


def _configure_stdio() -> None:
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        return
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def _configure_history() -> callable | None:
    history_path = os.environ.get("FINNA_MCP_HISTORY", "~/.finna_mcp_history")
    history_file = os.path.expanduser(history_path)
    try:
        readline.set_auto_history(True)
        readline.set_history_length(1000)
    except Exception:
        pass
    try:
        readline.read_history_file(history_file)
    except FileNotFoundError:
        pass
    except Exception:
        return None

    def save_history() -> None:
        try:
            readline.write_history_file(history_file)
        except Exception:
            pass

    atexit.register(save_history)
    return save_history


_MODEL_CACHE: dict[str, object] = {"ts": 0.0, "data": []}


def _fetch_openrouter_models(force: bool = False) -> tuple[list[dict], bool]:
    cached = _MODEL_CACHE.get("data", [])
    ts = float(_MODEL_CACHE.get("ts", 0.0))
    if not force and cached and (time.time() - ts) < 3600:
        return cached, True  # type: ignore[return-value]
    api_key = os.environ.get("OPENROUTER_API_KEY")
    url = "https://openrouter.ai/api/v1/models"
    headers = {"accept": "application/json"}
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = json.loads(response.read().decode("utf-8"))
    data = payload.get("data", [])
    if isinstance(data, list) and data:
        _MODEL_CACHE["ts"] = time.time()
        _MODEL_CACHE["data"] = data
    return data, False


def _select_model(models: list[dict]) -> str | None:
    if not models:
        return None
    models = sorted(models, key=lambda item: item.get("name", ""))
    print("\nOpenRouter models (showing first 25):")
    for idx, item in enumerate(models[:25], start=1):
        print(f"{idx:2d}. {item.get('id')} - {item.get('name')}")
    choice = input("Select model number (or press Enter to cancel): ").strip()
    if not choice:
        return None
    try:
        index = int(choice)
    except ValueError:
        return choice
    if 1 <= index <= min(25, len(models)):
        return models[index - 1].get("id")
    return None


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
            user_input = input(
                "\nAsk a question (/clear, /exit, /models[!], /model <id>): "
            ).strip()
            if not user_input:
                continue
            if user_input.lower() == "/exit":
                break
            if user_input.lower().startswith("/model "):
                selection = user_input.split(" ", 1)[1].strip()
                if selection:
                    model = selection
                    agent.model = model
                    print(f"Selected model: {model}")
                continue
            if user_input.lower().startswith("/models"):
                force = user_input.strip().lower().endswith("!")
                try:
                    models, cached = _fetch_openrouter_models(force=force)
                except Exception as exc:
                    print(f"\nERROR: failed to fetch OpenRouter models: {exc}")
                    continue
                if cached:
                    print("\n(Using cached OpenRouter model list)")
                selected = _select_model(models)
                if selected:
                    model = selected
                    agent.model = model
                    print(f"Selected model: {model}")
                continue
            if user_input.lower() == "/clear":
                history = []
                print("History cleared.")
                continue
            await run_with_history(user_input)
            if save_history:
                save_history()


def main() -> None:
    parser = argparse.ArgumentParser(description="PydanticAI MCP CLI")
    parser.add_argument("question", nargs="*", help="Question to ask the model")
    args = parser.parse_args()

    _configure_stdio()
    save_history = _configure_history()

    question = " ".join(args.question).strip()

    mcp_url = os.environ.get("MCP_URL", "http://localhost:8787/mcp")
    model_id = os.environ.get("MODEL_ID", "openai:gpt-4o-mini")
    model = os.environ.get("MODEL", model_id)

    asyncio.run(run_cli(question, mcp_url, model))


if __name__ == "__main__":
    main()
