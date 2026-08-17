import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  variant?: "floating" | "inline";
  className?: string;
}

/**
 * Botão de alternar modo claro/escuro.
 * - variant="floating": fixo no canto inferior direito (default global).
 * - variant="inline": pra colocar em headers/toolbars.
 */
export function ThemeToggle({ variant = "inline", className }: ThemeToggleProps) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  if (variant === "floating") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
        title={isDark ? "Modo claro" : "Modo escuro"}
        className={cn(
          "fixed bottom-4 left-4 z-[9999] h-10 w-10 rounded-full",
          "bg-card/90 backdrop-blur text-card-foreground border border-border shadow-md",
          "hover:bg-accent hover:text-accent-foreground transition-colors",
          "flex items-center justify-center print:hidden",
          className
        )}
      >
        {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      title={isDark ? "Modo claro" : "Modo escuro"}
      className={className}
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}
