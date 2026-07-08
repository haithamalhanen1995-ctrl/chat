import React from 'react';

export interface CountryCode {
  code: string;
  dial_code: string;
  name: string;
  flag: string;
}

export const COUNTRIES: CountryCode[] = [
  { code: 'IQ', dial_code: '+964', name: 'العراق', flag: '🇮🇶' },
  { code: 'SA', dial_code: '+966', name: 'السعودية', flag: '🇸🇦' },
  { code: 'EG', dial_code: '+20', name: 'مصر', flag: '🇪🇬' },
  { code: 'AE', dial_code: '+971', name: 'الإمارات', flag: '🇦🇪' },
  { code: 'JO', dial_code: '+962', name: 'الأردن', flag: '🇯🇴' },
  { code: 'LB', dial_code: '+961', name: 'لبنان', flag: '🇱🇧' },
  { code: 'SY', dial_code: '+963', name: 'سوريا', flag: '🇸🇾' },
  { code: 'KW', dial_code: '+965', name: 'الكويت', flag: '🇰🇼' },
  { code: 'OM', dial_code: '+968', name: 'عمان', flag: '🇴🇲' },
  { code: 'QA', dial_code: '+974', name: 'قطر', flag: '🇶🇦' },
  { code: 'BH', dial_code: '+973', name: 'البحرين', flag: '🇧🇭' },
  { code: 'YE', dial_code: '+967', name: 'اليمن', flag: '🇾🇪' },
  { code: 'PS', dial_code: '+970', name: 'فلسطين', flag: '🇵🇸' },
  { code: 'LY', dial_code: '+218', name: 'ليبيا', flag: '🇱🇾' },
  { code: 'DZ', dial_code: '+213', name: 'الجزائر', flag: '🇩🇿' },
  { code: 'MA', dial_code: '+212', name: 'المغرب', flag: '🇲🇦' },
  { code: 'TN', dial_code: '+216', name: 'تونس', flag: '🇹🇳' },
  { code: 'SD', dial_code: '+249', name: 'السودان', flag: '🇸🇩' },
  { code: 'TR', dial_code: '+90', name: 'تركيا', flag: '🇹🇷' },
  { code: 'US', dial_code: '+1', name: 'الولايات المتحدة', flag: '🇺🇸' },
  { code: 'GB', dial_code: '+44', name: 'المملكة المتحدة', flag: '🇬🇧' },
  { code: 'CA', dial_code: '+1', name: 'كندا', flag: '🇨🇦' },
  { code: 'DE', dial_code: '+49', name: 'ألمانيا', flag: '🇩🇪' },
  { code: 'FR', dial_code: '+33', name: 'فرنسا', flag: '🇫🇷' },
  { code: 'SE', dial_code: '+46', name: 'السويد', flag: '🇸🇪' },
  { code: 'NL', dial_code: '+31', name: 'هولندا', flag: '🇳🇱' },
];

interface CountryCodeSelectorProps {
  value: string;
  onChange: (dialCode: string) => void;
  id?: string;
}

export const CountryCodeSelector: React.FC<CountryCodeSelectorProps> = ({
  value,
  onChange,
  id = 'country-code-select'
}) => {
  return (
    <div className="relative flex items-center">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 px-3 pr-8 bg-zinc-800 text-white rounded-r-lg border border-zinc-700 focus:border-emerald-500 focus:outline-none text-sm cursor-pointer appearance-none text-right flex items-center gap-1"
        dir="rtl"
      >
        {COUNTRIES.map((c) => (
          <option key={`${c.code}-${c.dial_code}`} value={c.dial_code}>
            {c.flag} {c.name} ({c.dial_code})
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-zinc-400">
        <svg
          className="fill-current h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
        >
          <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
        </svg>
      </div>
    </div>
  );
};
