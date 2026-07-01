"""Pure Python editdistance implementation.

Replaces the C extension (bycython) that requires MSVC to build.
API matches the original editdistance package: eval(), and __call__.
"""

from __future__ import annotations

__version__ = "0.8.1"


def eval(s1, s2):
    """Compute Levenshtein distance between two sequences."""
    if len(s1) < len(s2):
        return eval(s2, s1)
    if len(s2) == 0:
        return len(s1)
    previous_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
    return previous_row[-1]


__call__ = eval
