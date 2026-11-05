-- Project Management → Feedback: Project Completed Feedback.
--
-- The last of a project's feedbacks asks for a review of Post Production (a row in
-- `project_feedback_area`, area POST_PRODUCTION, as Production Completion Feedback's areas are), the
-- client's Overall Experience - a rating - and an optional Suggestion. The two are columns of their
-- own on the feedback; both are null on every other stage.
--
-- Additive: two nullable columns. No permission: still PROJECT / Feedback.

ALTER TABLE `project_feedback`
    ADD COLUMN `overall_experience` VARCHAR(20) NULL,
    ADD COLUMN `suggestion` TEXT NULL;
