-- The branch's own web address, for the documents that print one.
--
-- Optional, like the email and the second phone number beside it: a branch is reachable without a
-- site of its own, and most studios have one address for all of them. It sits with the contact
-- details rather than with the registration, because that is what it is.
--
-- 255 characters, which is the length a URL column is given by convention and far more than a
-- studio's own address needs. Stored exactly as it is written - the scheme, the case and any path
-- are the studio's to decide.
ALTER TABLE `branch`
  ADD COLUMN `website_url` VARCHAR(255) NULL AFTER `email`;
