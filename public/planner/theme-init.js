try {
  const preference = localStorage.getItem("daybreak.theme");
  if (preference === "light" || preference === "dark") {
    document.documentElement.dataset.theme = preference;
  }
} catch (error) {
  console.error("Could not read the saved Daybreak theme preference.", error);
}
