from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
import huggingface_hub.file_download as file_download
from huggingface_hub import constants, set_client_factory, snapshot_download
from huggingface_hub.utils import _http
from huggingface_hub.utils._http import hf_request_event_hook


MODEL_FILES = {
    "meta-llama/Meta-Llama-3-8B-Instruct": (
        "config.json",
        "generation_config.json",
        "model-*.safetensors",
        "model.safetensors.index.json",
        "special_tokens_map.json",
        "tokenizer.json",
        "tokenizer_config.json",
    ),
    "McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp": (
        "adapter_config.json",
        "adapter_model.safetensors",
        "attn_mask_utils.py",
        "config.json",
        "modeling_llama_encoder.py",
        "special_tokens_map.json",
        "tokenizer.json",
        "tokenizer_config.json",
    ),
    "McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp-supervised": (
        "adapter_config.json",
        "adapter_model.safetensors",
    ),
}


def read_token() -> str:
    token_file = Path(os.getenv("HF_TOKEN_FILE", "/run/secrets/hf_token"))
    token = token_file.read_text(encoding="utf-8").strip()
    if not token.startswith("hf_"):
        raise RuntimeError(f"Invalid Hugging Face token in {token_file}")
    return token


def configure_mirror_redirects(token: str) -> None:
    endpoint_host = urlparse(constants.ENDPOINT).hostname
    if not endpoint_host:
        raise RuntimeError(f"Invalid HF_ENDPOINT: {constants.ENDPOINT}")

    token_hosts = {endpoint_host}
    allowed_hops: set[tuple[str | None, str | None]] = set()
    if endpoint_host != "huggingface.co":
        token_hosts.add("huggingface.co")
        allowed_hops.add((endpoint_host, "huggingface.co"))

    def redirect_auth_hook(request: httpx.Request) -> None:
        if request.url.host in token_hosts:
            request.headers["Authorization"] = f"Bearer {token}"
        else:
            request.headers.pop("Authorization", None)

    def client_factory() -> httpx.Client:
        return httpx.Client(
            follow_redirects=True,
            timeout=httpx.Timeout(30, read=60),
            event_hooks={"request": [redirect_auth_hook, hf_request_event_hook]},
        )

    def follow_mirror_redirect(
        method: str,
        url: str,
        *,
        retry_on_errors: bool = False,
        **httpx_kwargs: Any,
    ) -> httpx.Response:
        no_retry_kwargs = (
            {}
            if retry_on_errors
            else {"retry_on_exceptions": (), "retry_on_status_codes": ()}
        )
        while True:
            response = _http.http_backoff(
                method=method,
                url=url,
                **httpx_kwargs,
                follow_redirects=False,
                **no_retry_kwargs,
            )
            _http.hf_raise_for_status(response)
            if 300 <= response.status_code <= 399:
                location = response.headers["Location"]
                target = urljoin(url, location)
                source_host = urlparse(url).hostname
                target_host = urlparse(target).hostname
                if urlparse(location).netloc == "" or (source_host, target_host) in allowed_hops:
                    url = target
                    continue
            return response

    set_client_factory(client_factory)
    _http._httpx_follow_relative_redirects_with_backoff = follow_mirror_redirect
    file_download._httpx_follow_relative_redirects_with_backoff = follow_mirror_redirect


def main() -> int:
    parser = argparse.ArgumentParser(description="Prefetch Kimodo text encoder models")
    parser.add_argument("--max-workers", type=int, default=1, choices=range(1, 5))
    args = parser.parse_args()

    token = read_token()
    configure_mirror_redirects(token)
    print(f"Hugging Face endpoint: {constants.ENDPOINT}", flush=True)

    for repo_id, allow_patterns in MODEL_FILES.items():
        print(f"Downloading {repo_id}", flush=True)
        snapshot = snapshot_download(
            repo_id=repo_id,
            token=token,
            allow_patterns=list(allow_patterns),
            max_workers=args.max_workers,
        )
        print(f"Ready: {snapshot}", flush=True)

    print("Kimodo text encoder models are ready.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
