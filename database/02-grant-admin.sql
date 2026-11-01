-- Make an account a shop admin.
-- 1. Supabase > Authentication > Users > copy the user's UID.
-- 2. Paste it below in place of REPLACE_WITH_ADMIN_USER_UUID and run.
-- Only grant admin to people you trust: admins see every booking and customer.
insert into public.shop_admins(user_id)
values ('4e0e72e4-f715-4d5a-b9a1-305798800a5a'::uuid)
on conflict do nothing;
