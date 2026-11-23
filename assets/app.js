"use strict";

const legacyModulePages = {
  "#module-1": "modules/module1/module1.html",
  "#module-2": "modules/module2/module2.html",
  "#module-3": "modules/module3/module3.html",
  "#module-4": "modules/module4/Module4.html",
};

function openRequestedPage() {
  const page = legacyModulePages[window.location.hash];
  if (typeof page === "string") {
    window.location.replace(page);
    return;
  }
  document.getElementById("control").hidden = window.location.hash !== "#control";
}

window.addEventListener("hashchange", openRequestedPage);
openRequestedPage();
