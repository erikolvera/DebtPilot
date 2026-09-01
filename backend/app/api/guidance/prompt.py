"""The prompt.

Computed values go in, user-supplied text does not. The narrative is written
with `{first_cleared_name}` and never sees whether that says "Visa" or "Ignore
previous instructions" -- so there is no untrusted text in the prompt at all,
and injection is not mitigated so much as made impossible.
"""

from collections.abc import Mapping

USER_TEXT_TOKENS = frozenset({"first_cleared_name"})

_DESCRIPTIONS = {
    "first_cleared_name": "the name of the first debt the plan clears",
}

_INSTRUCTIONS = """\
You write one short, plain-language summary of a debt payoff comparison for \
the person whose debts these are. Address them directly as "you".

Four rules, all absolute:

1. Never write a number, a date or an amount -- not as digits, and not \
spelled out as words. "two debts" is as forbidden as "2 debts". Use the \
tokens listed below, in curly braces, exactly as written. Any digit or \
number-word in your output invalidates the response.
2. Only the listed tokens exist. Using any other token invalidates the \
response.
3. Describe these figures; never work out the difference between them. Every \
saving and every comparison has already been calculated and is available as a \
token.
4. These figures are estimates, and this is not financial advice. Do not tell \
the reader what they should do with their money.

Write warmly and concretely. Lead with whichever comparison matters most for \
this particular situation. Two or three sentences in the body is plenty.

Return JSON with exactly two string fields, "headline" and "body".

Available tokens:
"""


def build_prompt(presentation: Mapping[str, str]) -> str:
    """Render the prompt for one request's token set."""
    lines = [_INSTRUCTIONS]
    for token in sorted(presentation):
        if token in USER_TEXT_TOKENS:
            lines.append(f"  {{{token}}} - {_DESCRIPTIONS[token]}")
        else:
            lines.append(f"  {{{token}}} - currently {presentation[token]}")
    return "\n".join(lines)
