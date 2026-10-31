import { startApp } from "./js/app.js";

startApp().catch((error) => {
  console.error("Daybreak could not start.", error);
});
