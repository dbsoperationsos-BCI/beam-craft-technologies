-- Client logins (role CLIENT) were made with must_change_password = 0: a client kept the password the
-- studio sent and had no way to change it. The Beam Craft app now asks a client, on sign-in, to set
-- their own while this is 1, and clears it when they do. Every client login made before this still
-- has the studio's password, so each is asked once. Staff logins are not touched.
UPDATE `user` SET `must_change_password` = 1 WHERE `role` = 'CLIENT';
