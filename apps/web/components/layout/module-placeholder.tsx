import { MODULE_LINKS } from "@/lib/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ModulePlaceholder({ slug }: { slug: string }) {
  const moduleLink =
    MODULE_LINKS.find((link) => link.href === `/${slug}`) ??
    MODULE_LINKS[0];

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="text-2xl text-foreground">
          {moduleLink.label} module
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-muted-foreground">
        <p>
          Placeholder view for the{" "}
          <strong className="text-foreground">{moduleLink.label}</strong> module.
          Upcoming work will hydrate this page with role-based dashboards,
          event timelines, and quick actions.
        </p>
        <p>
          Track requirements in the Nova Bricks roadmap to see when this module
          receives its production-ready screens.
        </p>
      </CardContent>
    </Card>
  );
}
