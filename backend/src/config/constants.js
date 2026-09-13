export const ORDER_STATUS = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  ON_THE_WAY: 'On the way',
  AT_AGENCY: 'At agency',
  DELIVERED: 'Delivered',
  RETURNED: 'Returned',
  CANCELLED: 'Cancelled'
};

export const VALID_STATUS_TRANSITIONS = {
  [ORDER_STATUS.PENDING]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.ON_THE_WAY, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.ON_THE_WAY]: [ORDER_STATUS.AT_AGENCY, ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.AT_AGENCY]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.RETURNED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.DELIVERED]: [], // Final terminal state
  [ORDER_STATUS.RETURNED]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PENDING],
  [ORDER_STATUS.CANCELLED]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PENDING]
};

export const DELIVERY_METHODS = {
  AGENCY: 'agency',
  HOME: 'home'
};

export const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  STAFF: 'staff'
};

// 58 Wilayas of Algeria (Official territorial organization)
export const ALGERIA_WILAYAS = [
  { code: 1, name: 'Adrar', nameFr: 'Adrar', nameAr: 'أدرار', nameEn: 'Adrar' },
  { code: 2, name: 'Chlef', nameFr: 'Chlef', nameAr: 'الشلف', nameEn: 'Chlef' },
  { code: 3, name: 'Laghouat', nameFr: 'Laghouat', nameAr: 'الأغواط', nameEn: 'Laghouat' },
  { code: 4, name: 'Oum El Bouaghi', nameFr: 'Oum El Bouaghi', nameAr: 'أم البواقي', nameEn: 'Oum El Bouaghi' },
  { code: 5, name: 'Batna', nameFr: 'Batna', nameAr: 'باتنة', nameEn: 'Batna' },
  { code: 6, name: 'Béjaïa', nameFr: 'Béjaïa', nameAr: 'بجاية', nameEn: 'Bejaia' },
  { code: 7, name: 'Biskra', nameFr: 'Biskra', nameAr: 'بسكرة', nameEn: 'Biskra' },
  { code: 8, name: 'Béchar', nameFr: 'Béchar', nameAr: 'بشار', nameEn: 'Bechar' },
  { code: 9, name: 'Blida', nameFr: 'Blida', nameAr: 'البليدة', nameEn: 'Blida' },
  { code: 10, name: 'Bouira', nameFr: 'Bouira', nameAr: 'البويرة', nameEn: 'Bouira' },
  { code: 11, name: 'Tamanrasset', nameFr: 'Tamanrasset', nameAr: 'تمنراست', nameEn: 'Tamanrasset' },
  { code: 12, name: 'Tébessa', nameFr: 'Tébessa', nameAr: 'تبسة', nameEn: 'Tebessa' },
  { code: 13, name: 'Tlemcen', nameFr: 'Tlemcen', nameAr: 'تلمسان', nameEn: 'Tlemcen' },
  { code: 14, name: 'Tiaret', nameFr: 'Tiaret', nameAr: 'تيارت', nameEn: 'Tiaret' },
  { code: 15, name: 'Tizi Ouzou', nameFr: 'Tizi Ouzou', nameAr: 'تيزي وزو', nameEn: 'Tizi Ouzou' },
  { code: 16, name: 'Algiers', nameFr: 'Alger', nameAr: 'الجزائر', nameEn: 'Algiers' },
  { code: 17, name: 'Djelfa', nameFr: 'Djelfa', nameAr: 'الجلفة', nameEn: 'Djelfa' },
  { code: 18, name: 'Jijel', nameFr: 'Jijel', nameAr: 'جيجل', nameEn: 'Jijel' },
  { code: 19, name: 'Sétif', nameFr: 'Sétif', nameAr: 'سطيف', nameEn: 'Setif' },
  { code: 20, name: 'Saïda', nameFr: 'Saïda', nameAr: 'سعيدة', nameEn: 'Saida' },
  { code: 21, name: 'Skikda', nameFr: 'Skikda', nameAr: 'سكيكدة', nameEn: 'Skikda' },
  { code: 22, name: 'Sidi Bel Abbès', nameFr: 'Sidi Bel Abbès', nameAr: 'سيدي بلعباس', nameEn: 'Sidi Bel Abbes' },
  { code: 23, name: 'Annaba', nameFr: 'Annaba', nameAr: 'عنابة', nameEn: 'Annaba' },
  { code: 24, name: 'Guelma', nameFr: 'Guelma', nameAr: 'قالمة', nameEn: 'Guelma' },
  { code: 25, name: 'Constantine', nameFr: 'Constantine', nameAr: 'قسنطينة', nameEn: 'Constantine' },
  { code: 26, name: 'Médéa', nameFr: 'Médéa', nameAr: 'المدية', nameEn: 'Medea' },
  { code: 27, name: 'Mostaganem', nameFr: 'Mostaganem', nameAr: 'مستغانم', nameEn: 'Mostaganem' },
  { code: 28, name: 'M\'Sila', nameFr: 'M\'Sila', nameAr: 'المسيلة', nameEn: 'M\'Sila' },
  { code: 29, name: 'Mascara', nameFr: 'Mascara', nameAr: 'معسكر', nameEn: 'Mascara' },
  { code: 30, name: 'Ouargla', nameFr: 'Ouargla', nameAr: 'ورقلة', nameEn: 'Ouargla' },
  { code: 31, name: 'Oran', nameFr: 'Oran', nameAr: 'وهران', nameEn: 'Oran' },
  { code: 32, name: 'El Bayadh', nameFr: 'El Bayadh', nameAr: 'البيض', nameEn: 'El Bayadh' },
  { code: 33, name: 'Illizi', nameFr: 'Illizi', nameAr: 'إليزي', nameEn: 'Illizi' },
  { code: 34, name: 'Bordj Bou Arréridj', nameFr: 'Bordj Bou Arréridj', nameAr: 'برج بوعريريج', nameEn: 'Bordj Bou Arreridj' },
  { code: 35, name: 'Boumerdès', nameFr: 'Boumerdès', nameAr: 'بومرداس', nameEn: 'Boumerdes' },
  { code: 36, name: 'El Tarf', nameFr: 'El Tarf', nameAr: 'الطارف', nameEn: 'El Tarf' },
  { code: 37, name: 'Tindouf', nameFr: 'Tindouf', nameAr: 'تندوف', nameEn: 'Tindouf' },
  { code: 38, name: 'Tissemsilt', nameFr: 'Tissemsilt', nameAr: 'تيسمسيلت', nameEn: 'Tissemsilt' },
  { code: 39, name: 'El Oued', nameFr: 'El Oued', nameAr: 'الوادي', nameEn: 'El Oued' },
  { code: 40, name: 'Khenchela', nameFr: 'Khenchela', nameAr: 'خنشلة', nameEn: 'Khenchela' },
  { code: 41, name: 'Souk Ahras', nameFr: 'Souk Ahras', nameAr: 'سوق أهراس', nameEn: 'Souk Ahras' },
  { code: 42, name: 'Tipaza', nameFr: 'Tipaza', nameAr: 'تيبازة', nameEn: 'Tipaza' },
  { code: 43, name: 'Mila', nameFr: 'Mila', nameAr: 'ميلة', nameEn: 'Mila' },
  { code: 44, name: 'Aïn Defla', nameFr: 'Aïn Defla', nameAr: 'عين الدفلى', nameEn: 'Ain Defla' },
  { code: 45, name: 'Naâma', nameFr: 'Naâma', nameAr: 'النعامة', nameEn: 'Naama' },
  { code: 46, name: 'Aïn Témouchent', nameFr: 'Aïn Témouchent', nameAr: 'عين تموشنت', nameEn: 'Ain Temouchent' },
  { code: 47, name: 'Ghardaïa', nameFr: 'Ghardaïa', nameAr: 'غرداية', nameEn: 'Ghardaia' },
  { code: 48, name: 'Relizane', nameFr: 'Relizane', nameAr: 'غليزان', nameEn: 'Relizane' },
  { code: 49, name: 'Timimoun', nameFr: 'Timimoun', nameAr: 'تيميمون', nameEn: 'Timimoun' },
  { code: 50, name: 'Bordj Badji Mokhtar', nameFr: 'Bordj Badji Mokhtar', nameAr: 'برج باجي مختار', nameEn: 'Bordj Badji Mokhtar' },
  { code: 51, name: 'Ouled Djellal', nameFr: 'Ouled Djellal', nameAr: 'أولاد جلال', nameEn: 'Ouled Djellal' },
  { code: 52, name: 'Béni Abbès', nameFr: 'Béni Abbès', nameAr: 'بني عباس', nameEn: 'Beni Abbes' },
  { code: 53, name: 'In Salah', nameFr: 'In Salah', nameAr: 'عين صالح', nameEn: 'In Salah' },
  { code: 54, name: 'In Guezzam', nameFr: 'In Guezzam', nameAr: 'عين قزام', nameEn: 'In Guezzam' },
  { code: 55, name: 'Touggourt', nameFr: 'Touggourt', nameAr: 'تقرت', nameEn: 'Touggourt' },
  { code: 56, name: 'Djanet', nameFr: 'Djanet', nameAr: 'جانت', nameEn: 'Djanet' },
  { code: 57, name: 'El M\'Ghair', nameFr: 'El M\'Ghair', nameAr: 'المغير', nameEn: 'El M\'Ghair' },
  { code: 58, name: 'El Meniaa', nameFr: 'El Meniaa', nameAr: 'المنيعة', nameEn: 'El Meniaa' }
];

