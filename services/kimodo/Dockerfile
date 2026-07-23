FROM nvcr.io/nvidia/pytorch:24.10-py3

ARG KIMODO_REF=1aece8c124d73d255ceff5086d983b844c9f4e94
ARG PIP_INDEX_URL=https://pypi.org/simple

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/workspace

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates cmake curl git \
    && rm -rf /var/lib/apt/lists/*

RUN rm -f /usr/local/bin/cmake || true

COPY services/kimodo/requirements.txt /tmp/director-kimodo-requirements.txt

RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install --upgrade pip \
    && python -m pip install -r /tmp/director-kimodo-requirements.txt \
    && SKIP_MOTION_CORRECTION_IN_SETUP=1 python -m pip install \
      "kimodo @ git+https://github.com/nv-tlabs/kimodo.git@${KIMODO_REF}"

RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install --no-deps \
      "git+https://github.com/nv-tlabs/kimodo.git@${KIMODO_REF}#subdirectory=MotionCorrection"

COPY services/__init__.py /workspace/services/__init__.py
COPY services/kimodo/__init__.py /workspace/services/kimodo/__init__.py
COPY services/kimodo/app /workspace/services/kimodo/app
COPY services/kimodo/docker-entrypoint.sh /usr/local/bin/director-kimodo-entrypoint

RUN sed -i 's/\r$//' /usr/local/bin/director-kimodo-entrypoint \
    && chmod +x /usr/local/bin/director-kimodo-entrypoint \
    && mkdir -p /data /cache/huggingface

EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD curl -fsS http://127.0.0.1:8787/api/v1/health || exit 1

ENTRYPOINT ["director-kimodo-entrypoint"]
CMD ["uvicorn", "services.kimodo.app.main:app", "--host", "0.0.0.0", "--port", "8787"]
