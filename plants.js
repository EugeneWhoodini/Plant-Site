const plants = [
  ...Array.from({ length: 50 }, (_, i) => {
    const num = i + 1;
    return {
      name: `Plant ${num}`,
      price: (Math.random() * 15 + 3).toFixed(2),
      images: [
        `PlantImages/Plant${num}/1.jpg`,
        `PlantImages/Plant${num}/2.jpg`,
        `PlantImages/Plant${num}/3.jpg`
      ],
      description: `Sample description for Plant ${num}. Easy to care for.`,
      requirements: [
        "Medium light",
        "CO2 optional",
        "Weekly fertilization"
      ]
    };
  })
];