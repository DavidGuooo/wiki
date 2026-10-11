"""Executed only by XHS-Downloader's isolated Python, not imported by the pipeline."""
import asyncio
import json
import sys
from pathlib import Path


def main():
    install, url, output, result = sys.argv[1:5]
    sys.path[0] = install  # Do not let adapters/http.py shadow Python's http package.
    from source import XHS

    async def fetch():
        async with XHS(work_path=output, folder_name="Download", name_format="作品ID",
                       author_archive=False, folder_mode=False, download_record=False,
                       cookie="", timeout=30) as xhs:
            # XHS-Downloader stages every download in one shared Volume/Temp and, closing, deletes
            # it when empty, so parallel runs removed the folder under each other (FileNotFoundError).
            # Stage in this run's own folder, beside the result file in the adapter's temp directory.
            temp = Path(result).parent / "Temp"
            temp.mkdir()
            xhs.manager.temp = xhs.downloader.temp = temp
            records = await xhs.extract(url, download="--metadata-only" not in sys.argv[5:], check_record=False)
            if len(records) != 1 or not records[0]:
                raise RuntimeError("expected one post")
            Path(result).write_text(json.dumps(records[0], ensure_ascii=False))
    asyncio.run(fetch())


if __name__ == "__main__":
    main()
