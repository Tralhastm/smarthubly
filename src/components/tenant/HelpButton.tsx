import { useState } from 'react';
import { HelpCircle, Lightbulb } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet';
import { HELP_CONTENT } from '@/lib/help-content';

interface Props {
  /** Chave em HELP_CONTENT (ex: "dashboard", "orders") */
  topic: string;
  /** Tamanho do botão. Default "sm". */
  size?: 'sm' | 'md';
  /** Texto opcional ao lado do ícone. */
  label?: string;
}

const HelpButton = ({ topic, size = 'sm', label }: Props) => {
  const [open, setOpen] = useState(false);
  const entry = HELP_CONTENT[topic];

  if (!entry) return null;

  const iconSize = size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  const padding = size === 'md' ? 'h-9 px-3' : 'h-8 px-2.5';

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={`Ajuda: ${entry.title}`}
          className={`inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors ${padding}`}
        >
          <HelpCircle className={iconSize} />
          {label && <span className="text-xs font-medium">{label}</span>}
        </button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-heading text-xl text-foreground">
            Como usar: {entry.title}
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            {entry.intro}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {entry.sections.map((s) => (
            <section key={s.heading}>
              <h3 className="text-sm font-semibold text-foreground mb-2">{s.heading}</h3>
              <ul className="space-y-1.5">
                {s.body.map((line, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex gap-2">
                    <span className="text-primary mt-0.5">•</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {entry.tip && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex gap-2">
              <Lightbulb className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-foreground">
                <span className="font-semibold text-primary">Dica: </span>
                {entry.tip}
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default HelpButton;
