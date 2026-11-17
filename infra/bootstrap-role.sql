CREATE ROLE roomie_app LOGIN;
GRANT rds_iam TO roomie_app;
GRANT CONNECT ON DATABASE roomie TO roomie_app;
GRANT USAGE ON SCHEMA public TO roomie_app;
GRANT SELECT, INSERT ON
    public.room_members, public.room_invites, public.google_identities
    TO roomie_app;
GRANT SELECT, INSERT, UPDATE ON
    public.users, public.notifications
    TO roomie_app;
-- Room locks require UPDATE on at least one column of the locked relation.
GRANT SELECT, INSERT ON public.rooms TO roomie_app;
GRANT UPDATE (id) ON public.rooms TO roomie_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
    public.chores, public.chore_rotation_members, public.shopping_items, public.expenses,
    public.expense_shares, public.settlements
    TO roomie_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO roomie_app;
