import argparse
import asyncio
import io
import json
import os
import sys
import urllib.request
import time
import subprocess

from rich.text import Text
from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical
from textual.widgets import Button, Footer, Header, Input, Static, RichLog, Select

from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStreamableHTTP


def _configure_stdio() -> None:
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        return
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def _format_error(exc: Exception) -> str:
    lines = [f"{exc.__class__.__name__}: {exc}"]
    cause = exc.__cause__ or exc.__context__
    if cause and cause is not exc:
        lines.append(f"Caused by {cause.__class__.__name__}: {cause}")
    return " | ".join(lines)


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
_MODEL_PREFS_PATH = os.path.join(os.path.dirname(__file__), ".openrouter_model.json")


def _load_saved_model() -> str | None:
    try:
        with open(_MODEL_PREFS_PATH, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except FileNotFoundError:
        return None
    except Exception:
        return None
    if isinstance(payload, dict):
        model = payload.get("model")
        if isinstance(model, str) and model:
            return model
    return None


def _save_selected_model(model_id: str) -> None:
    try:
        with open(_MODEL_PREFS_PATH, "w", encoding="utf-8") as handle:
            json.dump({"model": model_id}, handle)
    except Exception:
        pass


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
    #conversation, #responses {
      border: solid $accent;
    }
    #conversation {
      height: 3fr;
    }
    #responses {
      height: 2fr;
    }
    #conversation-header, #responses-header {
      height: 3;
      align: left middle;
    }
    #conversation-label, #responses-label {
      width: 1fr;
    }
    #conversation-header Button, #responses-header Button {
      min-width: 8;
      margin-left: 1;
    }
    #model-label, #model-filter, #model-select {
      height: 3;
      border: solid $accent;
    }
    #prompt {
      height: 3;
      border: solid $accent;
      width: 1fr;
    }
    #prompt-row {
      height: 3;
    }
    #prompt-row Button {
      min-width: 8;
      margin-left: 1;
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
        self.model_option_values: set[str] = set()
        self.conversation_lines: list[str] = []
        self.response_lines: list[str] = []
        self.current_task: asyncio.Task | None = None
        self._init_lock = asyncio.Lock()

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield Vertical(
            Horizontal(
                Static("Conversation", id="conversation-label"),
                Button("Copy", id="conversation-copy"),
                Button("Clear", id="conversation-clear"),
                id="conversation-header",
            ),
            RichLog(id="conversation", wrap=True, auto_scroll=True),
            Horizontal(
                Static("MCP Responses", id="responses-label"),
                Button("Copy", id="responses-copy"),
                Button("Clear", id="responses-clear"),
                id="responses-header",
            ),
            RichLog(id="responses", wrap=False, auto_scroll=True),
        )
        yield Static("Model (use /models to load)", id="model-label")
        yield Input(placeholder="Filter models...", id="model-filter")
        yield Select([], prompt="Select model", id="model-select")
        yield Horizontal(
            Input(placeholder="Ask a question (/clear, /exit, /models[!], /model <id>)", id="prompt"),
            Button("Stop", id="stop-run"),
            id="prompt-row",
        )
        yield Footer()

    async def on_mount(self) -> None:
        saved_model = _load_saved_model()
        if saved_model:
            self.model = saved_model
            self._append_conversation(f"System: Restored model {self.model}", style="blue")
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
            self.model_option_values = {value for value, _ in options}
            selector.disabled = False
            self.query_one("#model-filter", Input).disabled = False
            if saved_model:
                normalized = _normalize_openrouter_model(saved_model)
                if normalized in self.model_option_values:
                    selector.value = normalized
        if self.question:
            await self._handle_user_input(self.question)

    async def _ensure_agent(self) -> None:
        async with self._init_lock:
            if self.agent:
                return

            async def process_tool_call(ctx, call_tool, name, tool_args):
                self._append_conversation(
                    f"Tool call: {name} {json.dumps(tool_args, ensure_ascii=True)}",
                    style="yellow",
                )
                try:
                    result = await call_tool(name, tool_args, None)
                except Exception as exc:
                    self._append_responses(_format_error(exc))
                    raise
                response_text = json.dumps(result, ensure_ascii=True, default=str)
                args_text = json.dumps(tool_args, ensure_ascii=True)
                size_kb = len(response_text.encode("utf-8")) / 1024
                self._append_responses(
                    f"[{size_kb:.1f} KB] {name} {args_text} -> {response_text}"
                )
                return result

            self.server = MCPServerStreamableHTTP(self.mcp_url, process_tool_call=process_tool_call)
            await self.server.__aenter__()
            self.agent = Agent(self.model, toolsets=[self.server], instructions=self._instructions())

    def _instructions(self) -> str:
        return (
            "You are a data assistant for Finna via MCP. "
            "Use the available MCP tools to search records and fetch metadata. "
            "For libraries/organizations/buildings, use list_organizations (facet) and not search_records. "
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
            self.conversation_lines.clear()
            self.response_lines.clear()
            self.query_one("#conversation", RichLog).clear()
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
        if self.current_task and not self.current_task.done():
            self._append_conversation(
                "System: Request already in progress. Press Stop to cancel.",
                style="blue",
            )
            return
        self.current_task = asyncio.create_task(self._run_agent(user_input))

    async def _run_agent(self, user_input: str) -> None:
        self._append_conversation(f"User: {user_input}", style="cyan")
        await self._ensure_agent()
        assert self.agent is not None
        try:
            result = await self.agent.run(user_input, model_settings={"stream": False})
        except asyncio.CancelledError:
            self._append_conversation("System: Request cancelled.", style="blue")
            return
        except Exception as exc:
            self._append_conversation(f"Error: {_format_error(exc)}", style="red")
            return
        else:
            output = result.output if hasattr(result, "output") else str(result)
            self._append_conversation(f"Assistant: {output}", style="green")
        finally:
            self.current_task = None

    async def _list_models(self, force: bool = False) -> None:
        self._append_conversation("System: Fetching OpenRouter models...", style="blue")
        try:
            models, cached = await asyncio.to_thread(_fetch_openrouter_models, force)
        except Exception as exc:
            self._append_conversation(f"System: Failed to fetch models: {exc}", style="blue")
            return
        if cached:
            self._append_conversation("System: Using cached OpenRouter model list.", style="blue")
        self.model_options = models
        for line in _format_model_list(models):
            self._append_conversation(line, style="blue")
        options = self._build_model_options(models, query="")
        selector = self.query_one("#model-select", Select)
        selector.set_options(options)
        self.model_option_values = {value for value, _ in options}
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
        if not chosen:
            self._append_conversation("System: Invalid model selection.", style="blue")
            return
        self.model = _normalize_openrouter_model(chosen)
        if self.agent:
            self.agent.model = self.model
        self._append_conversation(f"System: Selected model {self.model}", style="blue")
        _save_selected_model(self.model)
        selector = self.query_one("#model-select", Select)
        if selector.value != chosen:
            if chosen in self.model_option_values:
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
        self.model_option_values = {value for value, _ in options}

    async def on_button_pressed(self, event: Button.Pressed) -> None:
        button_id = event.button.id or ""
        if button_id == "stop-run":
            if self.current_task and not self.current_task.done():
                self.current_task.cancel()
                self._append_conversation("System: Stopping request...", style="blue")
            else:
                self._append_conversation("System: No request in progress.", style="blue")
            return
        if button_id == "conversation-copy":
            self._copy_to_clipboard("\n".join(self.conversation_lines))
            self._append_conversation("System: Copied conversation to clipboard.", style="blue")
            return
        if button_id == "responses-copy":
            self._copy_to_clipboard("\n".join(self.response_lines))
            self._append_responses("System: Copied responses to clipboard.")
            return
        if button_id == "conversation-clear":
            self.conversation_lines.clear()
            self.query_one("#conversation", RichLog).clear()
            return
        if button_id == "responses-clear":
            self.response_lines.clear()
            self.query_one("#responses", RichLog).clear()
            return

    def _append_conversation(self, line: str, style: str | None = None) -> None:
        self.conversation_lines.append(line)
        if style:
            self.query_one("#conversation", RichLog).write(Text(line, style=style))
        else:
            self.query_one("#conversation", RichLog).write(line)

    def _append_responses(self, line: str) -> None:
        self.response_lines.append(line)
        self.query_one("#responses", RichLog).write(line)

    def _copy_to_clipboard(self, content: str) -> None:
        if not content:
            return
        try:
            subprocess.run(
                ["xclip", "-selection", "clipboard"],
                input=content,
                text=True,
                check=True,
            )
        except Exception:
            self._append_conversation("System: Failed to copy to clipboard.", style="blue")

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
        if self.current_task and not self.current_task.done():
            self.current_task.cancel()
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
