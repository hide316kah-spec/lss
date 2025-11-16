dayBtn.addEventListener("click", () => {
  setMode("day");
  modeSelect.style.display = "none";
  modeLabel.style.display = "block";
  app.style.display = "block";
  startCamera().then(()=>loop());
});

nightBtn.addEventListener("click", () => {
  setMode("night");
  modeSelect.style.display = "none";
  modeLabel.style.display = "block";
  app.style.display = "block";
  startCamera().then(()=>loop());
});

debugBtn.addEventListener("click", () => {
  setMode("debug");
  modeSelect.style.display = "none";
  modeLabel.style.display = "block";
  app.style.display = "block";
  startCamera().then(()=>loop());
});
