"""Pure integer arithmetic; no notes, logging, or HTTP endpoints."""
from collections import defaultdict


def split_equal(amount_minor, participant_ids):
    ids = sorted(set(participant_ids))
    if type(amount_minor) is not int or amount_minor <= 0 or not ids:
        raise ValueError("Positive integer amount and participants required")
    base, remainder = divmod(amount_minor, len(ids))
    return {uid: base + (index < remainder) for index, uid in enumerate(ids)}


def compute_balances(expenses, settlements=()):
    """Expenses: (payer_id, {user_id: share_minor}); settlements: (debtor, creditor, amount, status)."""
    pairs = defaultdict(int)
    members = set()

    def add(debtor, creditor, amount):
        members.update((debtor, creditor))
        if debtor != creditor:
            low, high = sorted((debtor, creditor))
            pairs[low, high] += amount if debtor == low else -amount

    for payer, shares in expenses:
        members.add(payer)
        for participant, share in shares.items():
            add(participant, payer, share)
    for debtor, creditor, amount, status in settlements:
        if status == "paid":
            add(debtor, creditor, -amount)
    debts = {}
    balances = dict.fromkeys(members, 0)
    for (low, high), amount in pairs.items():
        debtor, creditor = (low, high) if amount > 0 else (high, low)
        if amount:
            debts[debtor, creditor] = abs(amount)
            balances[debtor] -= abs(amount)
            balances[creditor] += abs(amount)
    return balances, debts


def validate_settlement(amount_minor, outstanding_minor, pending_minor=0):
    """Write handlers call this inside their serialized DB transaction.

    Creation reserves pending requests; confirmation excludes its own reservation.
    """
    if type(amount_minor) is not int or amount_minor <= 0:
        raise ValueError("Settlement must be a positive integer amount")
    if amount_minor > outstanding_minor - pending_minor:
        raise ValueError("Settlement exceeds current outstanding debt")
