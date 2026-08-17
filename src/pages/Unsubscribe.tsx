import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle2, XCircle, Mail } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type State = "loading" | "valid" | "invalid" | "already" | "submitting" | "done" | "error";

const Unsubscribe = () => {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    (async () => {
      try {
        const r = await fetch(
          `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: SUPABASE_ANON_KEY } }
        );
        const data = await r.json();
        if (!r.ok) {
          setState("invalid");
          return;
        }
        if (data?.valid) setState("valid");
        else if (data?.reason === "already_unsubscribed") setState("already");
        else setState("invalid");
      } catch (e: any) {
        setErrorMsg(e.message);
        setState("error");
      }
    })();
  }, [token]);

  const handleConfirm = async () => {
    if (!token) return;
    setState("submitting");
    try {
      const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", {
        body: { token },
      });
      if (error) throw error;
      if ((data as any)?.success) setState("done");
      else if ((data as any)?.reason === "already_unsubscribed") setState("already");
      else setState("error");
    } catch (e: any) {
      setErrorMsg(e.message);
      setState("error");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center space-y-4 shadow-xl">
        <div className="mx-auto w-14 h-14 rounded-full gradient-primary flex items-center justify-center">
          <Mail className="h-7 w-7 text-primary-foreground" />
        </div>

        {state === "loading" && (
          <>
            <h1 className="font-heading text-xl text-foreground">Verificando link...</h1>
            <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />
          </>
        )}

        {state === "valid" && (
          <>
            <h1 className="font-heading text-xl text-foreground">Cancelar inscrição</h1>
            <p className="text-sm text-muted-foreground">
              Tem certeza que deseja parar de receber e-mails desta plataforma?
            </p>
            <button
              onClick={handleConfirm}
              className="w-full rounded-lg gradient-primary text-primary-foreground py-2.5 font-medium hover:opacity-90"
            >
              Confirmar cancelamento
            </button>
          </>
        )}

        {state === "submitting" && (
          <>
            <h1 className="font-heading text-xl text-foreground">Processando...</h1>
            <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />
          </>
        )}

        {state === "done" && (
          <>
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <h1 className="font-heading text-xl text-foreground">Inscrição cancelada</h1>
            <p className="text-sm text-muted-foreground">
              Você não receberá mais e-mails desta plataforma.
            </p>
          </>
        )}

        {state === "already" && (
          <>
            <CheckCircle2 className="h-12 w-12 text-muted-foreground mx-auto" />
            <h1 className="font-heading text-xl text-foreground">Já cancelado</h1>
            <p className="text-sm text-muted-foreground">
              Esse e-mail já foi removido da nossa lista anteriormente.
            </p>
          </>
        )}

        {state === "invalid" && (
          <>
            <XCircle className="h-12 w-12 text-red-500 mx-auto" />
            <h1 className="font-heading text-xl text-foreground">Link inválido</h1>
            <p className="text-sm text-muted-foreground">
              Este link de cancelamento não é válido ou já expirou.
            </p>
          </>
        )}

        {state === "error" && (
          <>
            <XCircle className="h-12 w-12 text-red-500 mx-auto" />
            <h1 className="font-heading text-xl text-foreground">Erro</h1>
            <p className="text-sm text-muted-foreground">{errorMsg || "Tente novamente mais tarde."}</p>
          </>
        )}
      </div>
    </div>
  );
};

export default Unsubscribe;
