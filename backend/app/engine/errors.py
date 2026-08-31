"""Engine exceptions.

Only genuine "I cannot answer your question" cases live here. A portfolio that
never pays off is a *result*, not an exception — see ``Outcome`` in models.py.
"""


class InvalidDebt(ValueError):
    """Raised when inputs cannot produce a meaningful simulation."""
