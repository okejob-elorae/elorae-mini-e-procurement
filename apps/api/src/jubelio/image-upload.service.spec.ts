import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { JubelioImageUploadService, type UploadInput } from "./image-upload.service";
import { PRISMA } from "../db/prisma.module";
import { JubelioHttpService } from "./http.service";

const UPLOAD_RESPONSE = {
  success: true,
  key: "https://j.blob/foo.jpeg",
  thumbnail: "https://j.blob/foo_thumb.jpeg",
  name: "foo.jpeg",
};

function makeImage(overrides: Partial<UploadInput> = {}): UploadInput {
  return {
    id: "img_1",
    url: "https://r2.example.com/foo.jpeg",
    jubelioImageKey: null,
    ...overrides,
  };
}

describe("JubelioImageUploadService", () => {
  let service: JubelioImageUploadService;
  let prisma: { itemImage: { update: jest.Mock } };
  let http: { upload: jest.Mock };
  let uuidSpy: jest.SpyInstance;

  beforeEach(async () => {
    prisma = {
      itemImage: { update: jest.fn().mockResolvedValue({}) },
    };
    http = {
      upload: jest.fn().mockResolvedValue(UPLOAD_RESPONSE),
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob(["x"])),
    });

    uuidSpy = jest.spyOn(
      { randomUUID } as unknown as { randomUUID: typeof randomUUID },
      "randomUUID",
    );

    const mod = await Test.createTestingModule({
      providers: [
        JubelioImageUploadService,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();

    service = mod.get(JubelioImageUploadService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (global.fetch as jest.Mock).mockReset();
  });

  it("empty input → no-op (no http calls, no prisma updates)", async () => {
    await service.ensureUploaded([]);
    expect(http.upload).not.toHaveBeenCalled();
    expect(prisma.itemImage.update).not.toHaveBeenCalled();
  });

  it("all inputs already have jubelioImageKey → no-op", async () => {
    const images = [
      makeImage({ jubelioImageKey: "existing-key-1" }),
      makeImage({ id: "img_2", jubelioImageKey: "existing-key-2" }),
    ];
    await service.ensureUploaded(images);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(http.upload).not.toHaveBeenCalled();
    expect(prisma.itemImage.update).not.toHaveBeenCalled();
  });

  it("one image missing key → fetches R2, posts multipart, persists key + thumbnail", async () => {
    const img = makeImage();
    await service.ensureUploaded([img]);

    expect(global.fetch).toHaveBeenCalledWith(img.url);
    expect(http.upload).toHaveBeenCalledWith(
      "/inventory/upload-image/",
      expect.any(FormData),
    );
    expect(prisma.itemImage.update).toHaveBeenCalledWith({
      where: { id: img.id },
      data: {
        jubelioImageKey: UPLOAD_RESPONSE.key,
        jubelioImageThumbnail: UPLOAD_RESPONSE.thumbnail,
        syncedAt: expect.any(Date),
      },
    });
  });

  it("two images, one cached + one missing → only uploads the missing one", async () => {
    const cached = makeImage({ id: "img_cached", jubelioImageKey: "already-uploaded" });
    const pending = makeImage({ id: "img_pending", url: "https://r2.example.com/bar.jpeg" });

    await service.ensureUploaded([cached, pending]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(pending.url);
    expect(http.upload).toHaveBeenCalledTimes(1);
    expect(prisma.itemImage.update).toHaveBeenCalledTimes(1);
    expect(prisma.itemImage.update).toHaveBeenCalledWith({
      where: { id: pending.id },
      data: expect.objectContaining({ jubelioImageKey: UPLOAD_RESPONSE.key }),
    });
  });

  it("upload http error → propagates, persists nothing for that image, earlier uploads stay", async () => {
    const img1 = makeImage({ id: "img_1", url: "https://r2.example.com/first.jpeg" });
    const img2 = makeImage({ id: "img_2", url: "https://r2.example.com/second.jpeg" });

    http.upload
      .mockResolvedValueOnce(UPLOAD_RESPONSE)
      .mockRejectedValueOnce(new Error("Jubelio 500"));

    await expect(service.ensureUploaded([img1, img2])).rejects.toThrow("Jubelio 500");

    // first image was persisted before the error
    expect(prisma.itemImage.update).toHaveBeenCalledTimes(1);
    expect(prisma.itemImage.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: img1.id } }),
    );
  });

  it("generates a fresh UUID per upload call", async () => {
    const img1 = makeImage({ id: "img_1", url: "https://r2.example.com/a.jpeg" });
    const img2 = makeImage({ id: "img_2", url: "https://r2.example.com/b.jpeg" });

    await service.ensureUploaded([img1, img2]);

    // upload called twice, each with a FormData containing a uid field
    expect(http.upload).toHaveBeenCalledTimes(2);

    const fd1 = http.upload.mock.calls[0][1] as FormData;
    const fd2 = http.upload.mock.calls[1][1] as FormData;

    const uid1 = fd1.get("uid") as string;
    const uid2 = fd2.get("uid") as string;

    expect(uid1).toBeTruthy();
    expect(uid2).toBeTruthy();
    // UUIDs are freshly generated — they differ from each other
    expect(uid1).not.toEqual(uid2);
  });

  it("R2 fetch returns non-OK → throws with the URL + status in message", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      blob: () => Promise.resolve(new Blob([""])),
    });

    const img = makeImage({ url: "https://r2.example.com/private.jpeg" });

    await expect(service.ensureUploaded([img])).rejects.toThrow(
      /R2 fetch failed.*private\.jpeg.*403/,
    );
    expect(http.upload).not.toHaveBeenCalled();
    expect(prisma.itemImage.update).not.toHaveBeenCalled();
  });
});
