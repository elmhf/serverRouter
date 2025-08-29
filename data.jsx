"use client";

import styles from "@/app/component/dashboard/main/ToothLabels/ToothChar/ToothChar.module.css";
import { useState, useEffect } from "react";
import { FaExclamation } from "react-icons/fa";
import data6 from './data/6.json';

const ToothChar = (teeth ) => {
  console.log("------------")
  console.log(teeth['data2'])
  console.log("-----2-------")
  let teethData=teeth['data2']['teeth']
  const [ToothJSX, setToothJSX] = useState(null);


  useEffect(() => {
    console.log(teethData['teeth'] && teethData['teeth'].length > 0 )
    if (teethData && teethData.length > 0) {
        teethData.map((tooth) => {
          const { toothNumber, category } = tooth;
          const backgroundColor = `rgba(var(--color-${category}), 0.2)`;
          const borderColor = `rgba(var(--color-${category}), 0.5)`;
          const textColor = `rgba(var(--color-${category}), 1)`;
          const element =document.getElementById(`Tooth-${toothNumber}`)
          if(element){
            element.style.backgroundColor=backgroundColor;
          element.style.borderColor=borderColor;
          }
          
        })
     
    }
  }, [teeth]);
};

export default ToothChar;