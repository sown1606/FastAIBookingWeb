import { useEffect, useState } from "react";

type AvatarVariant = "owner" | "staff" | "operator" | "customer";

const avatarSrc: Record<AvatarVariant, string> = {
  owner: "/assets/demo/avatar-owner.svg",
  staff: "/assets/demo/avatar-staff.svg",
  operator: "/assets/demo/avatar-operator.svg",
  customer: "/assets/demo/avatar-customer.svg"
};

export const DemoAvatar = ({
  name,
  variant = "staff",
  size = "md",
  src
}: {
  name: string;
  variant?: AvatarVariant;
  size?: "sm" | "md" | "lg";
  src?: string | null;
}) => {
  const fallbackSrc = avatarSrc[variant];
  const [imageSrc, setImageSrc] = useState(src?.trim() || fallbackSrc);

  useEffect(() => {
    setImageSrc(src?.trim() || fallbackSrc);
  }, [src, fallbackSrc]);

  return (
    <img
      className={`avatar avatar-${size}`}
      src={imageSrc}
      alt={name}
      loading="lazy"
      onError={() => {
        if (imageSrc !== fallbackSrc) {
          setImageSrc(fallbackSrc);
        }
      }}
    />
  );
};
