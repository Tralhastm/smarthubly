import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ImageUploadField from "./ImageUploadField";
import MediaGalleryField from "./MediaGalleryField";
import { uploadProductImage } from "@/hooks/useProductImageUpload";
import { toast } from "sonner";

vi.mock("@/hooks/useProductImageUpload", () => ({
  uploadProductImage: vi.fn(async () => "https://storage.test/img-enviada.jpg"),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ not: () => ({ limit: async () => ({ data: [] }) }) }) }),
    }),
    storage: {
      from: () => ({
        upload: vi.fn(async () => ({ error: null })),
        getPublicUrl: () => ({ data: { publicUrl: "https://storage.test/video.mp4" } }),
      }),
    },
  },
}));

vi.mock("@/lib/unifiedInvoke", () => ({ unifiedInvoke: vi.fn(async () => ({ data: null })) }));
vi.mock("@/lib/remove-image-bg", () => ({ removeSolidBackground: vi.fn(async () => null) }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

const imageFile = (name = "foto.jpg") =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });

const dropOn = (el: HTMLElement, init: Record<string, unknown>) =>
  fireEvent.drop(el, init);

const filesPayload = (files: File[]) => ({
  dataTransfer: {
    types: ["Files"],
    files,
    items: files.map((f) => ({ kind: "file", getAsFile: () => f })),
    getData: () => "",
  },
});

describe("adicionar foto arrastando a imagem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("envia a imagem solta no campo de foto única e devolve a URL", async () => {
    const onChange = vi.fn();
    render(<ImageUploadField value="" onChange={onChange} tenantId="loja-1" />);

    dropOn(screen.getByTestId("image-dropzone"), filesPayload([imageFile()]));

    await waitFor(() => expect(uploadProductImage).toHaveBeenCalledTimes(1));
    expect(vi.mocked(uploadProductImage).mock.calls[0][1]).toBe("loja-1");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("https://storage.test/img-enviada.jpg"));
  });

  it("usa a primeira imagem quando o usuário solta várias na foto principal", async () => {
    const onChange = vi.fn();
    render(<ImageUploadField value="" onChange={onChange} tenantId="loja-1" />);

    dropOn(
      screen.getByTestId("image-dropzone"),
      filesPayload([imageFile("a.jpg"), imageFile("b.jpg")]),
    );

    await waitFor(() => expect(uploadProductImage).toHaveBeenCalledTimes(1));
    expect(toast.info).toHaveBeenCalled();
  });

  it("aproveita o link de imagem arrastado de outra aba sem enviar arquivo", async () => {
    const onChange = vi.fn();
    render(<ImageUploadField value="" onChange={onChange} tenantId="loja-1" />);

    dropOn(screen.getByTestId("image-dropzone"), {
      dataTransfer: {
        types: ["text/uri-list"],
        files: [],
        items: [],
        getData: (kind: string) => (kind === "text/uri-list" ? "https://site.test/produto.png" : ""),
      },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("https://site.test/produto.png"));
    expect(uploadProductImage).not.toHaveBeenCalled();
  });

  it("avisa quando o arrasto não é uma imagem", async () => {
    const onChange = vi.fn();
    render(<ImageUploadField value="" onChange={onChange} tenantId="loja-1" />);

    dropOn(screen.getByTestId("image-dropzone"), filesPayload([new File(["x"], "planilha.csv", { type: "text/csv" })]));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adiciona várias fotos arrastadas na galeria do produto", async () => {
    const onChange = vi.fn();
    render(<MediaGalleryField value={[]} onChange={onChange} tenantId="loja-1" />);

    dropOn(
      screen.getByTestId("gallery-dropzone"),
      filesPayload([imageFile("1.jpg"), imageFile("2.png")]),
    );

    await waitFor(() => expect(uploadProductImage).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        { type: "image", url: "https://storage.test/img-enviada.jpg" },
        { type: "image", url: "https://storage.test/img-enviada.jpg" },
      ]),
    );
  });

  it("mantém o clique normal na galeria funcionando", () => {
    const onChange = vi.fn();
    render(<MediaGalleryField value={[]} onChange={onChange} tenantId="loja-1" />);
    expect(screen.getByText(/Adicionar fotos\/vídeo à galeria/i)).toBeInTheDocument();
  });
});
