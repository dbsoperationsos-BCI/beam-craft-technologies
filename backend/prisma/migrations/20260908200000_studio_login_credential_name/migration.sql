-- What the studio calls this system, in the email that gives somebody their login.
--
-- The credentials email named the product from a constant in the template: every studio running
-- this application told its new employees the same name, whatever they call it themselves. The name
-- belongs beside the Global Name and the logo, on the row the studio already edits in Settings.
--
-- Nullable, and read as "use the name the template ships with" when it is: an unset field must not
-- reach a new employee as a blank in the subject line of the first email they get.
ALTER TABLE `image_selection_settings`
  ADD COLUMN `login_credential_name` VARCHAR(120) NULL AFTER `studio_name`;
