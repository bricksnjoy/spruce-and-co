-- 031 · One set of books for now. While the whole back office is still being
-- tried out, the Test book is switched off in the app (the Live/Test switch
-- is gone); everyone works in Live. The Test book's machinery stays in the
-- database, so it can be switched back on later.
update public.profiles set active_book = 'live' where active_book is distinct from 'live';
