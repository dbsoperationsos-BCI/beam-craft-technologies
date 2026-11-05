-- A client's chats go with their project: a project deleted outright takes its chats (and, through
-- `client_chat_message_thread_fk`, their messages) with it, rather than leaving chats on Sales ->
-- Client Chats that belong to no project. Projects are normally only marked deleted, which this does
-- not touch.
--
-- Every chat is opened from an existing project, so there is no row this can fail on.

ALTER TABLE `client_chat_thread`
  ADD CONSTRAINT `client_chat_thread_project_fk` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
