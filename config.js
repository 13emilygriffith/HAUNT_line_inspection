// Settings for the line-review page.
window.REVIEW_CONFIG = {
  // URL of the Google Apps Script web app that writes ratings to the Google Sheet (ends in /exec).
  // See README.md, "Connect the Google Sheet". Leave empty to keep ratings only in each reviewer's browser.
  SHEET_URL: "",

  // Rating choices: value stored in the sheet, button text, keyboard key.
  RATINGS: [
    { value: "accept (strong, independent)", label: "Accept: strong, independent", key: "1", cls: "accept" },
    { value: "accept (blended)",             label: "Accept: blended",             key: "2", cls: "accept" },
    { value: "maybe (blended)",              label: "Maybe: blended",              key: "3", cls: "maybe" },
    { value: "maybe (weak)",                 label: "Maybe: weak",                 key: "4", cls: "maybe" },
    { value: "maybe (poor line list)",       label: "Maybe: poor line list",       key: "5", cls: "maybe" },
    { value: "reject",                       label: "Reject",                      key: "6", cls: "reject" },
  ],

  // Plot colours: synthesis by line list, GHOST spectrum always black.
  COLORS: {
    ji:      { synth: "#08519c", no_el: "#6baed6" },
    tsfitpy: { synth: "#a63603", no_el: "#fd8d3c" },
    obs: "#000000",
  },
};
