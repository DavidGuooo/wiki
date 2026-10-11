"""Transcribe audio chunks with the shared local Qwen3-ASR model.

Run with the QwenASR venv python: asr.py <qwen config.json> <output.json> <chunk>...
Holds the shared GPU lock (config['lock']) for the whole batch and loads the model once;
the process exits afterwards so no model stays resident.
"""
import fcntl
import json
import os
import sys
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

config = json.loads(Path(sys.argv[1]).read_text())
output, chunks = Path(sys.argv[2]), sys.argv[3:]
with open(config['lock'], 'a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    from mlx_audio.stt import load
    model = load(config['model'])
    texts = [model.generate(chunk, language=None, max_tokens=2048).text.strip() for chunk in chunks]
output.write_text(json.dumps(texts, ensure_ascii=False))
