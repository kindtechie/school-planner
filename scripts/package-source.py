"""Produce a portable source archive without local environments or school data."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {'.venv', '.build-venv', '.git', '__pycache__', 'data', 'dist', 'build', 'test-results', '.pytest_cache'}


def main():
    destination = ROOT/'dist/HamDars-source-1.0.0.zip'
    destination.parent.mkdir(exist_ok=True)
    with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
        for file in sorted(ROOT.rglob('*')):
            relative = file.relative_to(ROOT)
            if not file.is_file() or EXCLUDED.intersection(relative.parts) or file.suffix in {'.pyc', '.spec'}:
                continue
            archive.write(file, Path('school-planner')/relative)
    print(destination)


if __name__ == '__main__':
    main()
