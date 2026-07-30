"""Voice utterance parsing and player matching.

Prime directive: never produce a confident wrong answer silently.
The matcher returns graded confidences; the API layer turns those into
"auto-commit toast" vs "explicit tap" confirmation flows.
"""

from .matching import match_player
from .parser import parse_utterance

__all__ = ["match_player", "parse_utterance"]
