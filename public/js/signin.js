// The sign-in page: say why the last attempt failed, and offer Google once the
// server has it set up.
const PROBLEMS = {
  cancelled: "Sign-in was cancelled. Choose a way to sign in to continue.",
  expired: "That sign-in took too long or was started elsewhere. Try again.",
  rejected: "Cognito did not accept that sign-in. Try again.",
  invalid: "That sign-in could not be verified. Try again.",
  unreachable: "The sign-in service could not be reached. Try again in a moment.",
  failed: "Sign-in failed. Try again.",
};

const problem = PROBLEMS[new URLSearchParams(location.search).get("problem")];
if (problem) {
  const note = document.querySelector("#problem");
  note.textContent = problem;
  note.hidden = false;
}

fetch("/api/health")
  .then((response) => response.json())
  .then(({ google }) => {
    document.querySelector("#google").hidden = !google;
  })
  .catch(() => {});
