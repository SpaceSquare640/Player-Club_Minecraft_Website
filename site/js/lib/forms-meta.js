// Issue Form metadata shared by the site (issue links), the form generator and the Issue parser.
// No DOM and no browser globals.

/** Issue Form file names by request kind (.github/ISSUE_TEMPLATE). */
export const ISSUE_TEMPLATES = Object.freeze({
  add: "1-add-point.yml",
  edit: "2-edit-point.yml",
  delete: "3-delete-point.yml",
  spawn: "4-edit-spawn.yml",
});

/** Field ids that the site prefills through query parameters. */
export const FORM_FIELDS = Object.freeze({
  targetId: "target_id",
});

/** Issue labels of the request workflow. Forms apply only coordRequest and the type label (never approved). */
export const LABELS = Object.freeze({
  coordRequest: "coord-request",
  pendingReview: "pending-review",
  needsFix: "needs-fix",
  approved: "approved",
  applied: "applied",
  deployFailed: "deploy-failed",
});

/** Request type label by request kind. */
export const TYPE_LABELS = Object.freeze({
  add: "type:add",
  edit: "type:edit",
  delete: "type:delete",
  spawn: "type:spawn",
});
