import { Container } from "@/components/ui/container";

export function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-neutral-0 py-3">
      <Container>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-neutral-600">
            Zeve CRM · uso interno da equipe comercial
          </p>
          <p className="font-mono text-xs text-neutral-400">
            ambiente de desenvolvimento
          </p>
        </div>
      </Container>
    </footer>
  );
}
