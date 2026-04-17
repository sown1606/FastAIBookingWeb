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
  size = "md"
}: {
  name: string;
  variant?: AvatarVariant;
  size?: "sm" | "md" | "lg";
}) => {
  return (
    <img
      className={`avatar avatar-${size}`}
      src={avatarSrc[variant]}
      alt={name}
      loading="lazy"
    />
  );
};
