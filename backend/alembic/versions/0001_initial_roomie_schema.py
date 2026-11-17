"""initial Roomie schema"""
from alembic import op
import sqlalchemy as sa


revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=254), nullable=False),
        sa.Column('password_hash', sa.String(length=100), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('color', sa.String(length=7), server_default='#BF8790', nullable=False),
        sa.Column('eye_style', sa.String(length=10), server_default='plain', nullable=False),
        sa.Column('gaze', sa.String(length=10), server_default='straight', nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("color IN ('#BF8790','#C48F78','#8D9C83','#C5A078','#A68D84','#DB8999','#9A786F','#9D76CF')"),
        sa.CheckConstraint("eye_style IN ('plain','lashes')"),
        sa.CheckConstraint("gaze IN ('straight','left','right','up','happy','sleepy')"),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email')
    )
    op.create_table('google_identities',
        sa.Column('google_sub', sa.String(length=255), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('google_sub'),
        sa.UniqueConstraint('user_id')
    )
    op.create_table('rooms',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('number', sa.String(length=12), nullable=False),
        sa.Column('accent', sa.String(length=7), nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('chores',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('room_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=False),
        sa.Column('difficulty', sa.Integer(), nullable=False),
        sa.Column('due_at', sa.DateTime(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('repeat', sa.String(), nullable=False),
        sa.Column('rotation', sa.String(), nullable=False),
        sa.Column('previous_chore_id', sa.Integer(), nullable=True),
        sa.Column('accepted_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("repeat IN ('once','weekly')"),
        sa.CheckConstraint("rotation IN ('same','rotate')"),
        sa.CheckConstraint("status IN ('waiting','active','done')"),
        sa.CheckConstraint('difficulty BETWEEN 1 AND 5'),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['previous_chore_id'], ['chores.id'], ),
        sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('previous_chore_id')
    )
    op.create_index(op.f('ix_chores_room_id'), 'chores', ['room_id'], unique=False)
    op.create_table('expenses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('room_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('amount_minor', sa.Integer(), nullable=False),
        sa.Column('payer_id', sa.Integer(), nullable=False),
        sa.Column('note', sa.Text(), nullable=False),
        sa.Column('occurred_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('amount_minor > 0'),
        sa.ForeignKeyConstraint(['payer_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_expenses_room_id'), 'expenses', ['room_id'], unique=False)
    op.create_table('room_invites',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('room_id', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(length=64), nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code'),
        sa.UniqueConstraint('room_id')
    )
    op.create_table('room_members',
        sa.Column('room_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(), nullable=False),
        sa.Column('joined_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("role IN ('owner','member')"),
        sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('room_id', 'user_id')
    )
    op.create_table('settlements',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('room_id', sa.Integer(), nullable=False),
        sa.Column('debtor_id', sa.Integer(), nullable=False),
        sa.Column('creditor_id', sa.Integer(), nullable=False),
        sa.Column('amount_minor', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('requested_at', sa.DateTime(), nullable=False),
        sa.Column('paid_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("(status = 'paid' AND paid_at IS NOT NULL) OR (status = 'requested' AND paid_at IS NULL)"),
        sa.CheckConstraint("status IN ('requested','paid')"),
        sa.CheckConstraint('amount_minor > 0'),
        sa.CheckConstraint('debtor_id != creditor_id'),
        sa.ForeignKeyConstraint(['creditor_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['debtor_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_settlements_room_id'), 'settlements', ['room_id'], unique=False)
    op.create_table('shopping_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('room_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('done', sa.Boolean(), nullable=False),
        sa.Column('buyer_id', sa.Integer(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), nullable=False),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('(done = false AND buyer_id IS NULL AND completed_at IS NULL) OR (done = true AND buyer_id IS NOT NULL AND completed_at IS NOT NULL)'),
        sa.ForeignKeyConstraint(['buyer_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_shopping_items_room_id'), 'shopping_items', ['room_id'], unique=False)
    op.create_table('chore_rotation_members',
        sa.Column('chore_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.CheckConstraint('position >= 0'),
        sa.ForeignKeyConstraint(['chore_id'], ['chores.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('chore_id', 'user_id'),
        sa.UniqueConstraint('chore_id', 'position')
    )
    op.create_table('expense_shares',
        sa.Column('expense_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('share_minor', sa.Integer(), nullable=False),
        sa.CheckConstraint('share_minor >= 0'),
        sa.ForeignKeyConstraint(['expense_id'], ['expenses.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('expense_id', 'user_id')
    )
    op.create_table('notifications',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('recipient_id', sa.Integer(), nullable=False),
        sa.Column('actor_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=30), nullable=False),
        sa.Column('room_id', sa.Integer(), nullable=True),
        sa.Column('chore_id', sa.Integer(), nullable=True),
        sa.Column('expense_id', sa.Integer(), nullable=True),
        sa.Column('settlement_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('read_at', sa.DateTime(), nullable=True),
        sa.CheckConstraint("kind IN ('chore_assigned','expense_added','repayment_reported','repayment_confirmed','room_joined')"),
        sa.CheckConstraint('recipient_id != actor_id'),
        sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['chore_id'], ['chores.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['expense_id'], ['expenses.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['recipient_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['settlement_id'], ['settlements.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_notifications_recipient_id'), 'notifications', ['recipient_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_notifications_recipient_id'), table_name='notifications')
    op.drop_table('notifications')
    op.drop_table('expense_shares')
    op.drop_table('chore_rotation_members')
    op.drop_index(op.f('ix_shopping_items_room_id'), table_name='shopping_items')
    op.drop_table('shopping_items')
    op.drop_index(op.f('ix_settlements_room_id'), table_name='settlements')
    op.drop_table('settlements')
    op.drop_table('room_members')
    op.drop_table('room_invites')
    op.drop_index(op.f('ix_expenses_room_id'), table_name='expenses')
    op.drop_table('expenses')
    op.drop_index(op.f('ix_chores_room_id'), table_name='chores')
    op.drop_table('chores')
    op.drop_table('rooms')
    op.drop_table('google_identities')
    op.drop_table('users')
