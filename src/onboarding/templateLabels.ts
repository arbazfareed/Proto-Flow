import type { StarterTemplateId } from "./templates";

export const TEMPLATE_LABELS: Record<StarterTemplateId, { title: string; detail: string; icon: string }> = {
  blank: { title: "Blank project", detail: "A clean canvas to start from scratch.", icon: "blank" },
  "mobile-app": { title: "Mobile app", detail: "iPhone 15 device frame", icon: "mobile" },
  dashboard: { title: "Dashboard", detail: "Desktop 1440 with metrics and activity", icon: "dashboard" },
  "landing-page": { title: "Landing page", detail: "Desktop 1920 hero layout", icon: "landing" },
  "form-flow": { title: "Form flow", detail: "A two-step dynamic panel", icon: "form" },
  "data-table": { title: "Data table", detail: "A repeater with sample rows", icon: "table" },
  "responsive-web": { title: "Responsive web", detail: "Mobile, tablet, and desktop breakpoints", icon: "responsive" },
  login: { title: "Sign in", detail: "A polished, ready-to-edit login screen", icon: "login" },
  storefront: { title: "Storefront", detail: "A product detail page with cart actions", icon: "storefront" },
};
