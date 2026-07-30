"""Command line entry points: `python -m draftengine.cli <command>`."""

import sys


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if not args:
        print("usage: python -m draftengine.cli [refresh|train|validate]")
        return 2

    command = args[0]
    if command == "refresh":
        from .jobs.refresh import run_full_refresh

        run_full_refresh()
        return 0
    print(f"unknown command: {command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
