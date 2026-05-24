type SchoolBrandProps = {
  subtitle: string;
  title: string;
};

export const appTitle = "Mytilene Scholaris";
export const schoolName = "1ο Πρότυπο Γυμνάσιο Μυτιλήνης";
export const schoolLogoUrl = "https://1gym-mytil.les.sch.gr/wp-content/uploads/2025/12/cropped-cropped-brebas25.png";

export function SchoolBrand({ subtitle, title }: SchoolBrandProps) {
  return (
    <div className="brand">
      <span
        aria-label={schoolName}
        className="brand-logo"
        role="img"
        style={{ backgroundImage: `url(${schoolLogoUrl})` }}
      />
      <div>
        <h1>{title}</h1>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}
