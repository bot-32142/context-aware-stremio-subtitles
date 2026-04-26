function loadingSubtitle() {
  return `1
00:00:00,000 --> 04:00:00,000
Translation is running in the background.
Select this subtitle again in a little while to load the translated version.
`;
}

function errorSubtitle(message) {
  return `1
00:00:00,000 --> 04:00:00,000
${String(message || "Translation failed.").replace(/\r?\n/g, "\n")}
`;
}

module.exports = {
  errorSubtitle,
  loadingSubtitle
};
