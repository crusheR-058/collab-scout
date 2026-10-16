// The landing page's motion: scroll progress for the hero and the pinned
// sections, the orbit of categories round the two audiences, the field log's
// tilt, and reveals. Nothing moves for people who ask for reduced motion.
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

// A signed-in visitor goes straight back to their scouts.
fetch("/api/me")
  .then((response) => response.json())
  .then(({ email }) => {
    if (!email) return;
    for (const link of document.querySelectorAll("[data-cta]")) {
      link.textContent = link.closest(".nav") ? "Open Collab Scout" : "Open your scouts";
      link.href = "/scout";
    }
  })
  .catch(() => {});

const reveals = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("in");
      reveals.unobserve(entry.target);
    }
  },
  { threshold: 0.2 },
);
for (const node of document.querySelectorAll(".reveal")) reveals.observe(node);

if (!still) {
  const sections = [...document.querySelectorAll("[data-progress]")];
  const steps = [...document.querySelectorAll(".steps li")];
  const panels = [...document.querySelectorAll(".panel")];
  const chips = [...document.querySelectorAll("#ring b")];
  const rail = [...document.querySelectorAll(".rail li")];
  const reads = document.querySelector(".reads");
  const clamp = (value) => Math.min(1, Math.max(0, value));
  let lastStep = -1;

  // 0 at the top of a section, 1 when its pinned part has scrolled past.
  const progress = (section) => {
    const box = section.getBoundingClientRect();
    const travel = section === sections[0] ? box.height : box.height - innerHeight;
    return clamp(-box.top / Math.max(travel, 1));
  };

  const onScroll = () => {
    for (const section of sections) section.style.setProperty("--p", progress(section).toFixed(4));

    // The story: which step is showing, and how far through it the reader is.
    const story = progress(document.querySelector(".story")) * steps.length;
    const step = Math.min(steps.length - 1, Math.floor(story));
    const local = clamp((story - step) * 1.6);
    if (step !== lastStep) {
      steps.forEach((item, index) => item.toggleAttribute("data-active", index === step));
      panels.forEach((panel, index) => {
        panel.classList.toggle("on", index === step);
        panel.classList.toggle("past", index < step);
      });
      lastStep = step;
    }
    panels[step]?.style.setProperty("--lp", local.toFixed(4));

    const facing = Math.round(progress(reads) * (rail.length - 1));
    rail.forEach((item, index) => item.toggleAttribute("data-active", index === facing));
  };

  // Categories orbit the overlap on a tilted ellipse; depth is shown with
  // scale, opacity and stacking order rather than true 3D, which keeps the
  // chips readable and upright.
  const orbit = (time) => {
    const wide = innerWidth > 900;
    const radius = wide ? Math.min(innerWidth * 0.2, 290) : innerWidth * 0.38;
    chips.forEach((chip, index) => {
      const angle = time / 9000 + (index / chips.length) * Math.PI * 2;
      const depth = (Math.sin(angle) + 1) / 2;
      chip.style.transform = `translate(-50%, -50%) translate(${(Math.cos(angle) * radius).toFixed(1)}px, ${(Math.sin(angle) * radius * 0.34).toFixed(1)}px) scale(${(0.72 + depth * 0.45).toFixed(3)})`;
      chip.style.opacity = (0.65 + depth * 0.35).toFixed(3);
      chip.style.zIndex = depth > 0.5 ? 4 : 0;
    });
    requestAnimationFrame(orbit);
  };
  requestAnimationFrame(orbit);

  // The field log and spheres lean toward the pointer.
  const stage = document.querySelector(".stage");
  stage.addEventListener("pointermove", (event) => {
    const x = event.clientX / innerWidth - 0.5;
    const y = event.clientY / innerHeight - 0.5;
    stage.style.setProperty("--tx", `${(x * 10).toFixed(2)}deg`);
    stage.style.setProperty("--ty", `${(-y * 10).toFixed(2)}deg`);
    stage.style.setProperty("--px", `${(x * 24).toFixed(1)}px`);
    stage.style.setProperty("--py", `${(y * 24).toFixed(1)}px`);
  });

  addEventListener("scroll", () => requestAnimationFrame(onScroll), { passive: true });
  addEventListener("resize", onScroll);
  onScroll();
}
