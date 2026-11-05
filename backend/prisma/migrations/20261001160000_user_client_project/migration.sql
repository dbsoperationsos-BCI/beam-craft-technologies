-- Create Project → Client Credentials: a client's own sign-in, linked to the project it was made for.
--
-- A client login is a `user` row with `role` 'CLIENT' and this column naming its project - by key,
-- never by the project's code. Unique: one client login per project. SET NULL if the project row is
-- ever removed, so the account is left unlinked rather than taking a delete with it. Every existing
-- account is a studio account and is left NULL.
--
-- `email` becomes optional: a client signs in by username alone and is given no login email, so its
-- row holds NULL - never an invented address. Every existing account keeps the email it has; the
-- unique index stays, and MySQL lets any number of rows hold NULL under it.
--
-- Cost: one nullable column, one unique index and one foreign key on `user`, and `email` made
-- nullable. No row is rewritten.

-- AlterTable
ALTER TABLE `user` ADD COLUMN `client_project_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `user_client_project_id_key` ON `user`(`client_project_id`);

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_client_project_id_fkey` FOREIGN KEY (`client_project_id`) REFERENCES `sales_project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `user` MODIFY `email` VARCHAR(191) NULL;
