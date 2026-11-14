import pytest

from app.balances import compute_balances, split_equal, validate_settlement


def seed_expenses():
    return [(1, split_equal(68400, [1, 2, 3, 4])),
            (3, split_equal(25800, [1, 2, 3])),
            (2, split_equal(43200, [1, 2, 4]))]


def test_seed_balances_and_pairwise_debts():
    balances, debts = compute_balances(seed_expenses())
    assert balances == {1: 28300, 2: 3100, 3: 100, 4: -31500}
    assert debts == {(2, 1): 2700, (3, 1): 8500, (4, 1): 17100,
                     (2, 3): 8600, (4, 2): 14400}
    assert sum(balances.values()) == 0


def test_rounding_and_payer_excluded():
    assert split_equal(10000, [3, 1, 2]) == {1: 3334, 2: 3333, 3: 3333}
    balances, debts = compute_balances([(1, split_equal(101, [2, 3]))])
    assert balances == {1: 101, 2: -51, 3: -50}
    assert debts == {(2, 1): 51, (3, 1): 50}


def test_only_paid_settlements_affect_balances():
    assert compute_balances(seed_expenses(), [(2, 1, 2700, "requested")]) == compute_balances(seed_expenses())
    balances, debts = compute_balances(seed_expenses(), [(2, 1, 2700, "paid")])
    assert (2, 1) not in debts
    assert balances == {1: 25600, 2: 5800, 3: 100, 4: -31500}


@pytest.mark.parametrize("amount,outstanding,pending", [(2701, 2700, 0), (1, 0, 0), (0, 100, 0), (-1, 100, 0), (2000, 2700, 1000), (1.5, 100, 0)])
def test_overpayment_and_invalid_amounts(amount, outstanding, pending):
    with pytest.raises(ValueError):
        validate_settlement(amount, outstanding, pending)


def test_exact_debt_and_pending_reservation():
    validate_settlement(2700, 2700)
    validate_settlement(1700, 2700, 1000)
