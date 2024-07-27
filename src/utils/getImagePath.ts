import { Images } from '../types/images.type';

export const getImagePath = (image: Images) => {
  return `src/images/${image}`;
};
