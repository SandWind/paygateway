import { createFileRoute } from "@tanstack/react-router";

import { PaymentGatewaysPage } from "@/real/pages/PaymentGatewaysPage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "支付网关 | 后台控制面" },
      { name: "description", content: "Provider、渠道、商户与凭据版本的统一配置页。" },
      { property: "og:title", content: "支付网关 | 后台控制面" },
      { property: "og:description", content: "Provider、渠道、商户与凭据版本的统一配置页。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PaymentGatewaysPage,
});
