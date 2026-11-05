-- A read-only link to a submitted CRD document's answers.
--
-- Separate from `public_token` on purpose: that one opens the fillable form and is a credential to
-- submit, so it is not the thing to forward to whoever wants to read the response. This one is
-- issued on request, only ever reads, and can be handed to anyone.
--
-- Nullable and unseeded: a document has no share link until somebody asks for one.
ALTER TABLE `sales_project_crd_document`
  ADD COLUMN `share_token` VARCHAR(16) NULL,
  ADD UNIQUE INDEX `sales_project_crd_document_share_token_key` (`share_token`);
