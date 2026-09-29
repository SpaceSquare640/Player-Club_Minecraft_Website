// Issue Form metadata shared by the site (issue links) and, later, the form generator and parser.
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
