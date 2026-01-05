import argparse
import asyncio
import io
import json
import os
import sys
import urllib.request
import time

from textual.app import App, ComposeResult
from textual.containers import Vertical
from textual.widgets import Footer, Header, Input, Static, RichLog, Select

from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStreamableHTTP


def _configure_stdio() -> None:
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        return
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def _load_history() -> list[str]:
    history_path = os.environ.get("FINNA_MCP_HISTORY", "~/.finna_mcp_history")
    history_file = os.path.expanduser(history_path)
    entries: list[str] = []
    try:
        with open(history_file, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.rstrip("\n")
                if line:
                    entries.append(line)
    except FileNotFoundError:
        pass
    except Exception:
        return []
    return entries


def _save_history(entries: list[str]) -> None:
    history_path = os.environ.get("FINNA_MCP_HISTORY", "~/.finna_mcp_history")
    history_file = os.path.expanduser(history_path)
    try:
        with open(history_file, "w", encoding="utf-8") as handle:
            for entry in entries[-1000:]:
                handle.write(f"{entry}\n")
    except Exception:
        pass


_MODEL_CACHE: dict[str, object] = {"ts": 0.0, "data": []}
_CACHE_PATH = os.path.join(os.path.dirname(__file__), ".openrouter_models_cache.json")


def _load_model_cache() -> None:
    try:
        with open(_CACHE_PATH, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        _MODEL_CACHE["ts"] = float(payload.get("ts", 0.0))
        _MODEL_CACHE["data"] = payload.get("data", [])
    except FileNotFoundError:
        pass
    except Exception:
        return


def _save_model_cache() -> None:
    try:
        with open(_CACHE_PATH, "w", encoding="utf-8") as handle:
            json.dump(_MODEL_CACHE, handle)
    except Exception:
        pass


def _fetch_openrouter_models(force: bool = False) -> tuple[list[dict], bool]:
    _load_model_cache()
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
        _save_model_cache()
    return data, False


def _format_model_list(models: list[dict]) -> list[str]:
    if not models:
        return ["System: no models returned from OpenRouter."]
    models = sorted(models, key=lambda item: item.get("name", ""))
    lines = ["System: OpenRouter models (first 25):"]
    for idx, item in enumerate(models[:25], start=1):
        lines.append(f"{idx:2d}. {item.get('id')} - {item.get('name')}")
    lines.append("System: select with /model <number|id>.")
    return lines


def _normalize_openrouter_model(model_id: str) -> str:
    if model_id.startswith("openrouter:"):
        return model_id
    if not model_id:
        return model_id
    _load_model_cache()
    models = _MODEL_CACHE.get("data", [])
    if isinstance(models, list) and any(item.get("id") == model_id for item in models):
        return f"openrouter:{model_id}"
    return model_id


class FinnaTUI(App):
    CSS = """
    Screen {
      layout: vertical;
    }
    #conversation, #calls, #responses {
      height: 1fr;
      border: solid $accent;
    }
    #model-label, #model-filter, #model-select {
      height: 3;
      border: solid $accent;
    }
    #prompt {
      height: 3;
      border: solid $accent;
    }
    """

    BINDINGS = [
        ("ctrl+c", "quit", "Quit"),
        ("escape", "quit", "Quit"),
    ]

    def __init__(self, question: str, mcp_url: str, model: str) -> None:
        super().__init__()
        self.question = question
        self.mcp_url = mcp_url
        self.model = model
        self.agent: Agent | None = None
        self.server: MCPServerStreamableHTTP | None = None
        self.history_entries = _load_history()
        self.history_index = len(self.history_entries)
        self.model_options: list[dict] = []
        self._init_lock = asyncio.Lock()

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield Vertical(
            Static("Conversation", id="conversation-label"),
            RichLog(id="conversation", wrap=True, auto_scroll=True),
            Static("MCP Calls", id="calls-label"),
            RichLog(id="calls", wrap=True, auto_scroll=True),
            Static("MCP Responses", id="responses-label"),
            RichLog(id="responses", wrap=True, auto_scroll=True),
        )
        yield Static("Model (use /models to load)", id="model-label")
        yield Input(placeholder="Filter models...", id="model-filter")
        yield Select([], prompt="Select model", id="model-select")
        yield Input(placeholder="Ask a question (/clear, /exit, /models[!], /model <id>)", id="prompt")
        yield Footer()

    async def on_mount(self) -> None:
        await self._ensure_agent()
        self.query_one("#model-select", Select).disabled = True
        self.query_one("#model-filter", Input).disabled = True
        _load_model_cache()
        cached_models = _MODEL_CACHE.get("data", [])
        if isinstance(cached_models, list) and cached_models:
            self.model_options = cached_models
            options = self._build_model_options(self.model_options, query="")
            selector = self.query_one("#model-select", Select)
            selector.set_options(options)
            selector.disabled = False
            self.query_one("#model-filter", Input).disabled = False
        if self.question:
            await self._handle_user_input(self.question)

    async def _ensure_agent(self) -> None:
        async with self._init_lock:
            if self.agent:
                return

            async def process_tool_call(ctx, call_tool, name, tool_args):
                calls = self.query_one("#calls", RichLog)
                calls.write(json.dumps({"name": name, "arguments": tool_args}, ensure_ascii=True))
                try:
                    result = await call_tool(name, tool_args, None)
                except Exception as exc:
                    responses = self.query_one("#responses", RichLog)
                    responses.write(str(exc))
                    raise
                responses = self.query_one("#responses", RichLog)
                responses.write(json.dumps(result, ensure_ascii=True, default=str))
                return result

            self.server = MCPServerStreamableHTTP(self.mcp_url, process_tool_call=process_tool_call)
            await self.server.__aenter__()
            self.agent = Agent(self.model, toolsets=[self.server], instructions=self._instructions())

    def _instructions(self) -> str:
        return (
            "You are a data assistant for Finna via MCP. "
            "Use the available MCP tools to search records and fetch metadata. "
            "Prefer returning records with actionable resources (images, attachments, online URLs). "
            "When filters are needed, use the structured filter helper. "
            "Do not ask the user for more information unless absolutely required."
        )

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        user_input = event.value.strip()
        event.input.value = ""
        if not user_input:
            return
        await self._handle_user_input(user_input)

    async def _handle_user_input(self, user_input: str) -> None:
        if user_input.lower() == "/exit":
            await self.action_quit()
            return
        if user_input.lower() == "/clear":
            self.query_one("#conversation", RichLog).clear()
            self.query_one("#calls", RichLog).clear()
            self.query_one("#responses", RichLog).clear()
            return
        if user_input.lower().startswith("/models"):
            force = user_input.strip().lower().endswith("!")
            await self._list_models(force)
            return
        if user_input.lower().startswith("/model "):
            await self._select_model(user_input.split(" ", 1)[1].strip())
            return

        self._append_history(user_input)
        await self._ask_agent(user_input)

    async def _ask_agent(self, user_input: str) -> None:
        conversation = self.query_one("#conversation", RichLog)
        conversation.write(f"User: {user_input}")
        await self._ensure_agent()
        assert self.agent is not None
        try:
            result = await self.agent.run(user_input, model_settings={"stream": False})
        except Exception as exc:
            conversation.write(f"Error: {exc}")
            return
        output = result.output if hasattr(result, "output") else str(result)
        conversation.write(f"Assistant: {output}")

    async def _list_models(self, force: bool = False) -> None:
        conversation = self.query_one("#conversation", RichLog)
        conversation.write("System: Fetching OpenRouter models...")
        try:
            models, cached = await asyncio.to_thread(_fetch_openrouter_models, force)
        except Exception as exc:
            conversation.write(f"System: Failed to fetch models: {exc}")
            return
        if cached:
            conversation.write("System: Using cached OpenRouter model list.")
        self.model_options = models
        for line in _format_model_list(models):
            conversation.write(line)
        options = self._build_model_options(models, query="")
        selector = self.query_one("#model-select", Select)
        selector.set_options(options)
        selector.disabled = False
        self.query_one("#model-filter", Input).disabled = False

    async def _select_model(self, selection: str) -> None:
        if not selection or selection == "Select.BLANK":
            return
        chosen = None
        if selection.isdigit() and self.model_options:
            index = int(selection)
            if 1 <= index <= min(25, len(self.model_options)):
                chosen = self.model_options[index - 1].get("id")
        else:
            chosen = selection
        conversation = self.query_one("#conversation", RichLog)
        if not chosen:
            conversation.write("System: Invalid model selection.")
            return
        self.model = _normalize_openrouter_model(chosen)
        if self.agent:
            self.agent.model = self.model
        conversation.write(f"System: Selected model {self.model}")
        selector = self.query_one("#model-select", Select)
        if selector.value != chosen:
            try:
                option_values = {option.value for option in selector.options}
            except Exception:
                option_values = set()
            if chosen in option_values:
                selector.value = chosen

    def _append_history(self, user_input: str) -> None:
        self.history_entries.append(user_input)
        self.history_index = len(self.history_entries)
        _save_history(self.history_entries)

    async def on_key(self, event) -> None:
        if event.key == "up":
            await self._navigate_history(-1)
        elif event.key == "down":
            await self._navigate_history(1)

    async def on_select_changed(self, event: Select.Changed) -> None:
        if event.select.id != "model-select":
            return
        if not event.value or event.value is Select.BLANK or str(event.value) == "Select.BLANK":
            return
        await self._select_model(str(event.value))

    async def on_input_changed(self, event: Input.Changed) -> None:
        if event.input.id != "model-filter":
            return
        if not self.model_options:
            return
        options = self._build_model_options(self.model_options, query=event.value)
        selector = self.query_one("#model-select", Select)
        selector.set_options(options)

    def _build_model_options(self, models: list[dict], query: str) -> list[tuple[str, str]]:
        query = query.strip().lower()
        filtered = models
        if query:
            filtered = [
                item
                for item in models
                if query in str(item.get("id", "")).lower()
                or query in str(item.get("name", "")).lower()
            ]
        filtered = sorted(filtered, key=lambda entry: entry.get("name", ""))
        options: list[tuple[str, str]] = []
        for item in filtered[:50]:
            label = f"{item.get('id')} - {item.get('name')}"
            options.append((label, item.get("id")))
        return options

    async def _navigate_history(self, delta: int) -> None:
        if not self.history_entries:
            return
        self.history_index = max(0, min(len(self.history_entries), self.history_index + delta))
        prompt = self.query_one("#prompt", Input)
        if self.history_index >= len(self.history_entries):
            prompt.value = ""
        else:
            prompt.value = self.history_entries[self.history_index]
            prompt.cursor_position = len(prompt.value)

    async def on_shutdown_request(self) -> None:
        if self.server:
            await self.server.__aexit__(None, None, None)


def main() -> None:
    parser = argparse.ArgumentParser(description="PydanticAI MCP Textual TUI")
    parser.add_argument("question", nargs="*", help="Question to ask the model")
    args = parser.parse_args()

    _configure_stdio()

    question = " ".join(args.question).strip()

    mcp_url = os.environ.get("MCP_URL", "http://localhost:8787/mcp")
    model_id = os.environ.get("MODEL_ID", "openai:gpt-4o-mini")
    model = os.environ.get("MODEL", model_id)

    app = FinnaTUI(question, mcp_url, model)
    app.run()


if __name__ == "__main__":
    main()
